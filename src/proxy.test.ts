import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFRES_MAX_REQUESTS_PER_IP, OFFRES_WINDOW_MS } from '@/lib/rate-limit'

import { config, proxy } from './proxy'

// ─── Rate limit du périmètre public M5 (task 10) ─────────────────────────────
//
// Le store de rate-limit.ts est un Map au niveau module : il persiste entre
// les tests du fichier. Chaque scénario utilise donc une adresse IP
// distincte (plage de documentation TEST-NET-3) — ni reset global ni fake
// store nécessaires. Les réseaux sans en-tête IP sont couverts par le
// fail-open documenté dans src/proxy.ts.
//
// ─── Contrôle 404 pré-streaming (task 10b) ───────────────────────────────────
//
// `slugOffreVisible` (DAL) est mocké : ces tests verrouillent le DÉROULÉ
// du proxy (méthode, chemin, ordre rate limit → contrôle, cible du
// rewrite) ; la règle de visibilité derrière ce booléen est verrouillée
// par offres-public.test.ts, et le 404 HTTP strict par la validation
// HTTP/navigateur (routing non apparié en aval du rewrite).

const { slugOffreVisible } = vi.hoisted(() => ({
  slugOffreVisible: vi.fn<(slug: string) => Promise<boolean>>(),
}))

vi.mock('@/lib/offres-public', () => ({ slugOffreVisible }))

function requete(chemin: string, ip?: string, accept = '*/*'): NextRequest {
  const entetes: Record<string, string> = { accept }
  if (ip !== undefined) entetes['x-forwarded-for'] = ip
  return new NextRequest(`http://localhost:3000${chemin}`, { headers: entetes })
}

beforeEach(() => {
  slugOffreVisible.mockReset()
  slugOffreVisible.mockResolvedValue(true)
})

describe('proxy M5 (rate limit)', () => {
  it('couvre /offres, le sitemap et l’API logo — rien d’autre', () => {
    expect(config.matcher).toEqual([
      '/offres/:path*',
      '/sitemap.xml',
      '/api/files/logo',
    ])
  })

  it('laisse passer OFFRES_MAX_REQUESTS_PER_IP puis répond 429 HTML', async () => {
    const ip = '203.0.113.10'
    for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
      expect(await proxy(requete('/offres', ip, 'text/html'))).toBeUndefined()
    }

    const refus = await proxy(requete('/offres', ip, 'text/html'))
    expect(refus).toBeDefined()
    expect(refus?.status).toBe(429)
    expect(Number(refus?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(refus?.headers.get('content-type')).toContain('text/html')

    const corps = refus === undefined ? '' : await refus.text()
    expect(corps).toContain('Trop de requêtes')
    expect(corps).toContain('lang="fr"')
    expect(corps).toContain('noindex')

    // Une autre IP conserve son budget : le seau est propre à l'adresse.
    expect(
      await proxy(requete('/offres', '203.0.113.11', 'text/html')),
    ).toBeUndefined()
  })

  it('répond 429 JSON au format des erreurs API pour l’API logo', async () => {
    const ip = '203.0.113.20'
    for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
      expect(
        await proxy(requete('/api/files/logo?entrepriseId=1', ip)),
      ).toBeUndefined()
    }

    const refus = await proxy(requete('/api/files/logo?entrepriseId=1', ip))
    expect(refus?.status).toBe(429)
    expect(refus?.headers.get('content-type')).toContain('application/json')
    expect(await refus?.json()).toEqual({ error: 'Trop de requêtes.' })
  })

  it('n’impose aucune limite sans IP identifiable (fail-open documenté)', async () => {
    // Dev direct (aucun proxy) : ni x-forwarded-for ni x-real-ip → chaque
    // requête reste servie, aucun seau partagé « local » auto-DOSable.
    for (let i = 0; i < 5; i++) {
      expect(await proxy(requete('/offres'))).toBeUndefined()
    }
    expect(await proxy(requete('/sitemap.xml'))).toBeUndefined()
  })

  it('libère le seau à la fin de la fenêtre glissante', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-03T10:00:00.000Z'))
      const ip = '203.0.113.30'
      for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
        expect(await proxy(requete('/offres', ip))).toBeUndefined()
      }
      expect(await proxy(requete('/offres', ip))).toBeDefined()

      vi.advanceTimersByTime(OFFRES_WINDOW_MS + 1_000)
      expect(await proxy(requete('/offres', ip))).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('proxy M5 (404 pré-streaming des fiches)', () => {
  it('laisse passer une fiche visible : aucune réécriture', async () => {
    const reponse = await proxy(requete('/offres/developpeur-back-end-1'))

    expect(reponse).toBeUndefined()
    expect(slugOffreVisible).toHaveBeenCalledTimes(1)
    expect(slugOffreVisible).toHaveBeenCalledWith('developpeur-back-end-1')
  })

  it('réécrit vers /404 un slug absent, expiré ou brouillon', async () => {
    slugOffreVisible.mockResolvedValue(false)

    const reponse = await proxy(requete('/offres/developpeur-php-5'))

    // Le proxy ne POSE pas le statut (une réponse de rewrite vaut 200) :
    // il réécrit vers une URL volontairement sans route, et le routing
    // aval répond 404 strict — c'est ce mécanisme que la doc Next
    // recommande (loading.md §Status codes).
    expect(reponse).toBeDefined()
    expect(reponse?.status).toBe(200)
    expect(reponse?.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3000/404',
    )
  })

  it('couvre /offres/<numérique> (URL legacy) et barre oblique finale', async () => {
    slugOffreVisible.mockResolvedValue(false)

    for (const chemin of ['/offres/42', '/offres/developpeur-php-5/']) {
      const reponse = await proxy(requete(chemin))
      expect(reponse?.headers.get('x-middleware-rewrite')).toContain('/404')
    }
    expect(slugOffreVisible).toHaveBeenCalledTimes(2)
  })

  it('n’interroge pas la base derrière un 429 (rate limit d’abord)', async () => {
    const ip = '203.0.113.40'
    for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
      expect(await proxy(requete('/offres/quelque-slug-1', ip))).toBeUndefined()
    }
    slugOffreVisible.mockClear()

    const refus = await proxy(requete('/offres/quelque-slug-1', ip))

    expect(refus?.status).toBe(429)
    expect(slugOffreVisible).not.toHaveBeenCalled()
  })

  it('n’applique le contrôle qu’aux GET/HEAD de fiche', async () => {
    const post = new NextRequest(
      'http://localhost:3000/offres/developpeur-php-5',
      { method: 'POST' },
    )
    expect(await proxy(post)).toBeUndefined()

    // Liste (/offres sans segment final) et API hors contrôle de slug.
    expect(await proxy(requete('/offres'))).toBeUndefined()
    expect(
      await proxy(requete('/api/files/logo?entrepriseId=1')),
    ).toBeUndefined()
    expect(slugOffreVisible).not.toHaveBeenCalled()
  })
})
