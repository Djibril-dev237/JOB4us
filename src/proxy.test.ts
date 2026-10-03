import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import { OFFRES_MAX_REQUESTS_PER_IP, OFFRES_WINDOW_MS } from '@/lib/rate-limit'

import { config, proxy } from './proxy'

// ─── Rate limit du périmètre public M5 (task 10) ─────────────────────────────
//
// Le store de rate-limit.ts est un Map au niveau module : il persiste entre
// les tests du fichier. Chaque scénario utilise donc une adresse IP
// distincte (plage de documentation TEST-NET-3) — ni reset global ni fake
// store nécessaires. Les réseaux sans en-tête IP sont couverts par le
// fail-open documenté dans src/proxy.ts.

function requete(chemin: string, ip?: string, accept = '*/*'): NextRequest {
  const entetes: Record<string, string> = { accept }
  if (ip !== undefined) entetes['x-forwarded-for'] = ip
  return new NextRequest(`http://localhost:3000${chemin}`, { headers: entetes })
}

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
      expect(proxy(requete('/offres', ip, 'text/html'))).toBeUndefined()
    }

    const refus = proxy(requete('/offres', ip, 'text/html'))
    expect(refus).toBeDefined()
    expect(refus?.status).toBe(429)
    expect(Number(refus?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(refus?.headers.get('content-type')).toContain('text/html')

    const corps = refus === undefined ? '' : await refus.text()
    expect(corps).toContain('Trop de requêtes')
    expect(corps).toContain('lang="fr"')
    expect(corps).toContain('noindex')

    // Une autre IP conserve son budget : le seau est propre à l'adresse.
    expect(proxy(requete('/offres', '203.0.113.11', 'text/html'))).toBeUndefined()
  })

  it('répond 429 JSON au format des erreurs API pour l’API logo', async () => {
    const ip = '203.0.113.20'
    for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
      expect(proxy(requete('/api/files/logo?entrepriseId=1', ip))).toBeUndefined()
    }

    const refus = proxy(requete('/api/files/logo?entrepriseId=1', ip))
    expect(refus?.status).toBe(429)
    expect(refus?.headers.get('content-type')).toContain('application/json')
    expect(await refus?.json()).toEqual({ error: 'Trop de requêtes.' })
  })

  it('n’impose aucune limite sans IP identifiable (fail-open documenté)', () => {
    // Dev direct (aucun proxy) : ni x-forwarded-for ni x-real-ip → chaque
    // requête reste servie, aucun seau partagé « local » auto-DOSable.
    for (let i = 0; i < 5; i++) {
      expect(proxy(requete('/offres'))).toBeUndefined()
    }
    expect(proxy(requete('/sitemap.xml'))).toBeUndefined()
  })

  it('libère le seau à la fin de la fenêtre glissante', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-03T10:00:00.000Z'))
      const ip = '203.0.113.30'
      for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
        expect(proxy(requete('/offres', ip))).toBeUndefined()
      }
      expect(proxy(requete('/offres', ip))).toBeDefined()

      vi.advanceTimersByTime(OFFRES_WINDOW_MS + 1_000)
      expect(proxy(requete('/offres', ip))).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
