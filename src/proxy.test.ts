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
//
// ─── Gate par rôle (P0 M6, restauré) ─────────────────────────────────────────
//
// `decode` (next-auth/jwt) est mocké : le gate ne lit QUE le cookie, le
// décodage réel est couvert par Auth.js. Le secret doit exister pour que
// lireSession descende jusqu'à decode — forcé en début de fichier.
// Chaque scénario de rôle part d'une requête neuve (pas d'état partagé).
//
// ─── 404 pré-streaming de la gestion (M6, couche 4) ──────────────────────────
//
// `entrepriseDuCompte` + `lireOffreGestion` (DAL) sont mockés : ces tests
// verrouillent le DÉROULÉ (décision du gate → ownership → cible du
// rewrite) et le fail-closed (segment inconnu / id hors domaine → 404
// sans base) ; la règle d'ownership derrière est verrouillie par
// offres-dal.test.ts, et le 404 HTTP strict par la validation finale.

const { slugOffreVisible, decode, entrepriseDuCompte, lireOffreGestion } =
  vi.hoisted(() => ({
    slugOffreVisible: vi.fn<(slug: string) => Promise<boolean>>(),
    decode: vi.fn<(args: unknown) => Promise<Record<string, unknown> | null>>(),
    entrepriseDuCompte: vi.fn<(userId: number) => Promise<number | null>>(),
    lireOffreGestion: vi.fn<(offreId: number, entrepriseId: number) => Promise<unknown>>(),
  }))

vi.mock('@/lib/offres-public', () => ({ slugOffreVisible }))
vi.mock('@/lib/offres-dal', () => ({ entrepriseDuCompte, lireOffreGestion }))
vi.mock('next-auth/jwt', () => ({ decode }))

// Présence du secret : sinon lireSession s'arrête avant decode et tous
// les scénarios « connecté » dériveraient silencieusement en visiteur.
process.env.AUTH_SECRET ??= 'secret-de-test'

function requete(chemin: string, ip?: string, accept = '*/*'): NextRequest {
  const entetes: Record<string, string> = { accept }
  if (ip !== undefined) entetes['x-forwarded-for'] = ip
  return new NextRequest(`http://localhost:3000${chemin}`, { headers: entetes })
}

/** Requête portant (ou non) le cookie de session Auth.js. */
function requeteAvecSession(chemin: string, connecte = true): NextRequest {
  const entetes: Record<string, string> = { accept: '*/*' }
  if (connecte) entetes['cookie'] = 'authjs.session-token=jeton-de-test'
  return new NextRequest(`http://localhost:3000${chemin}`, { headers: entetes })
}

beforeEach(() => {
  slugOffreVisible.mockReset()
  slugOffreVisible.mockResolvedValue(true)
  decode.mockReset()
  decode.mockResolvedValue(null)
  // Recruteur de test : entreprise 3, offre 12 la sienne. Chaque scénario
  // de la couche 4 précise ses exceptions.
  entrepriseDuCompte.mockReset()
  entrepriseDuCompte.mockResolvedValue(3)
  lireOffreGestion.mockReset()
  lireOffreGestion.mockResolvedValue({ id: 12 })
})

describe('proxy M5 (rate limit)', () => {
  it('couvre le périmètre public M5 et les espaces connectés M1', () => {
    expect(config.matcher).toEqual([
      '/offres/:path*',
      '/sitemap.xml',
      '/api/files/logo',
      '/login',
      '/register',
      '/candidat/:path*',
      '/recruteur/:path*',
      '/admin/:path*',
      '/messages/:path*',
      '/notifications/:path*',
      '/parametres/:path*',
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

describe('proxy M6 (gate par rôle restauré — P0)', () => {
  function connecte(role: 'candidat' | 'recruteur' | 'admin', userId = 7): void {
    decode.mockResolvedValue({ userId, role })
  }

  it('envoie un visiteur à /login depuis chaque espace protégé', async () => {
    for (const chemin of [
      '/recruteur/offres',
      '/candidat/profil',
      '/messages',
      '/notifications',
      '/parametres',
    ]) {
      const reponse = await proxy(requeteAvecSession(chemin, false))
      expect(reponse?.status).toBe(307)
      expect(reponse?.headers.get('location')).toBe(
        'http://localhost:3000/login',
      )
      expect(decode).not.toHaveBeenCalled() // pas de cookie = pas de décodage
    }
  })

  it('répond 404 strict à un visiteur ou à un non-admin sur chaque route /admin', async () => {
    const routesAdmin = [
      '/admin/dashboard',
      '/admin/utilisateurs',
      '/admin/utilisateurs/7',
      '/admin/offres',
      '/admin/signalements',
      '/admin/signalements/7',
      '/admin/statistiques',
      '/admin/audit',
      '/admin/audit/export',
      '/admin/reauth',
    ]

    for (const chemin of routesAdmin) {
      const visiteur = await proxy(requeteAvecSession(chemin, false))
      expect(visiteur?.status).toBe(200)
      expect(visiteur?.headers.get('x-middleware-rewrite')).toBe(
        'http://localhost:3000/404',
      )
      expect(visiteur?.headers.get('location')).toBeNull()

      for (const role of ['candidat', 'recruteur'] as const) {
        connecte(role)
        const reponse = await proxy(requeteAvecSession(chemin))
        expect(reponse?.status).toBe(200)
        expect(reponse?.headers.get('x-middleware-rewrite')).toBe(
          'http://localhost:3000/404',
        )
        expect(reponse?.headers.get('location')).toBeNull()
      }
    }
  })

  it('refuse le bon rôle sur l’espace d’un autre par /unauthorized', async () => {
    connecte('candidat')
    expect(
      (await proxy(requeteAvecSession('/recruteur/offres')))?.headers.get('location'),
    ).toBe('http://localhost:3000/unauthorized')

    connecte('recruteur')
    expect(
      (await proxy(requeteAvecSession('/candidat/profil')))?.headers.get('location'),
    ).toBe('http://localhost:3000/unauthorized')

    // Parité legacy : ['auth','recruteur'] strict — un admin n’entre pas
    // dans l’espace recruteur (idem test api/entreprise « admin = 403 »).
    connecte('admin')
    expect(
      (await proxy(requeteAvecSession('/recruteur/offres')))?.headers.get('location'),
    ).toBe('http://localhost:3000/unauthorized')
  })

  it('laisse passer un connecté sur son propre espace (x-middleware-next)', async () => {
    connecte('recruteur')
    const reponseRecruteur = await proxy(requeteAvecSession('/recruteur/offres'))
    expect(reponseRecruteur?.headers.get('x-middleware-next')).toBe('1')

    connecte('admin')
    const reponseAdmin = await proxy(requeteAvecSession('/admin/dashboard'))
    expect(reponseAdmin?.headers.get('x-middleware-next')).toBe('1')
  })

  it('traite un jeton altéré comme un visiteur (déchiffrement échoué)', async () => {
    decode.mockRejectedValue(new Error('signature invalide'))

    const reponse = await proxy(requeteAvecSession('/recruteur/offres'))
    expect(reponse?.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('refuse un rôle absent ou inconnu dans le payload', async () => {
    decode.mockResolvedValue({ userId: 7 }) // aucun rôle
    expect(
      (await proxy(requeteAvecSession('/recruteur/offres')))?.headers.get('location'),
    ).toBe('http://localhost:3000/login')

    decode.mockResolvedValue({ userId: 7, role: 'super-admin' })
    expect(
      (await proxy(requeteAvecSession('/recruteur/offres')))?.headers.get('location'),
    ).toBe('http://localhost:3000/login')
  })

  it('redirige un connecté de /login et /register vers l’accueil', async () => {
    connecte('candidat')
    expect(
      (await proxy(requeteAvecSession('/login')))?.headers.get('location'),
    ).toBe('http://localhost:3000/')
    expect(
      (await proxy(requeteAvecSession('/register')))?.headers.get('location'),
    ).toBe('http://localhost:3000/')

    // Visiteur sur /login : aucune redirection (page publique).
    expect(await proxy(requeteAvecSession('/login', false))).toBeUndefined()
  })

  it('n’applique pas le budget public aux espaces connectés', async () => {
    // Épuise le seau public sur cette IP…
    const ip = '203.0.113.60'
    for (let i = 0; i < OFFRES_MAX_REQUESTS_PER_IP; i++) {
      expect(await proxy(requete('/offres', ip))).toBeUndefined()
    }
    expect((await proxy(requete('/offres', ip)))?.status).toBe(429)

    // …le même IP reste servie sur /recruteur : redirection de rôle,
    // jamais 429 (les clés offres:ip:* ne s’appliquent pas ici).
    connecte('recruteur')
    const reponse = await proxy(
      new NextRequest('http://localhost:3000/recruteur/offres', {
        headers: {
          accept: '*/*',
          'x-forwarded-for': ip,
          cookie: 'authjs.session-token=jeton-de-test',
        },
      }),
    )
    expect(reponse?.headers.get('x-middleware-next')).toBe('1')
    expect(reponse?.status).not.toBe(429)
  })
})

describe('proxy M6 (404 pré-streaming de la gestion — couche 4)', () => {
  function recruteurConnecte(userId = 7): void {
    decode.mockResolvedValue({ userId, role: 'recruteur' })
  }

  it('laisse passer l’offre du recruteur : ownership en une requête', async () => {
    recruteurConnecte()

    const reponse = await proxy(requeteAvecSession('/recruteur/offres/12'))

    expect(reponse?.headers.get('x-middleware-next')).toBe('1')
    expect(entrepriseDuCompte).toHaveBeenCalledTimes(1)
    expect(entrepriseDuCompte).toHaveBeenCalledWith(7)
    expect(lireOffreGestion).toHaveBeenCalledTimes(1)
    expect(lireOffreGestion).toHaveBeenCalledWith(12, 3)
  })

  it('réécrit vers /404 l’offre étrangère, supprimée ou inexistante', async () => {
    recruteurConnecte()
    // Étrangère, supprimée et inexistante : la DAL renvoie le même null
    // (même `where`) — un seul scénario verrouille les trois cas.
    lireOffreGestion.mockResolvedValue(null)

    for (const chemin of ['/recruteur/offres/12', '/recruteur/offres/12/editer']) {
      const reponse = await proxy(requeteAvecSession(chemin))
      expect(reponse?.status).toBe(200)
      expect(reponse?.headers.get('x-middleware-rewrite')).toBe(
        'http://localhost:3000/404',
      )
    }
  })

  it('blanchit la création et laisse les autres routes de l’espace', async () => {
    recruteurConnecte()

    for (const chemin of ['/recruteur/offres', '/recruteur/offres/creer', '/recruteur/dashboard']) {
      const reponse = await proxy(requeteAvecSession(chemin))
      expect(reponse?.headers.get('x-middleware-next')).toBe('1')
    }
    expect(entrepriseDuCompte).not.toHaveBeenCalled()
    expect(lireOffreGestion).not.toHaveBeenCalled()
  })

  it('réécrit sans base tout segment d’offre non numérique inconnu', async () => {
    recruteurConnecte()

    // Fail-closed : route d'offre attendue numérique, segment inconnu →
    // 404 immédiat, jamais une requête pour un identifiant non entier.
    const reponse = await proxy(requeteAvecSession('/recruteur/offres/nimporte-quoi'))
    expect(reponse?.headers.get('x-middleware-rewrite')).toContain('/404')
    expect(entrepriseDuCompte).not.toHaveBeenCalled()
  })

  it('écarte un id hors du domaine entier 32 bits sans requête base', async () => {
    recruteurConnecte()

    for (const chemin of [
      '/recruteur/offres/0',
      '/recruteur/offres/99999999999999999999',
    ]) {
      const reponse = await proxy(requeteAvecSession(chemin))
      expect(reponse?.headers.get('x-middleware-rewrite')).toContain('/404')
    }
    expect(entrepriseDuCompte).not.toHaveBeenCalled()
  })

  it('réécrit 404 pour un recruteur sans entreprise (il ne possède rien)', async () => {
    recruteurConnecte()
    entrepriseDuCompte.mockResolvedValue(null)

    const reponse = await proxy(requeteAvecSession('/recruteur/offres/12'))

    expect(reponse?.headers.get('x-middleware-rewrite')).toContain('/404')
    expect(lireOffreGestion).not.toHaveBeenCalled()
  })

  it('n’atteint jamais la couche 4 sans accès à l’espace', async () => {
    // Visiteur → /login ; candidat et admin → /unauthorized : la couche 4
    // ne s'exécute QUE derrière un gate autorisé (rôle recruteur).
    expect(
      (await proxy(requeteAvecSession('/recruteur/offres/12', false)))
        ?.headers.get('location'),
    ).toBe('http://localhost:3000/login')

    for (const role of ['candidat', 'admin'] as const) {
      decode.mockResolvedValue({ userId: 7, role })
      const reponse = await proxy(requeteAvecSession('/recruteur/offres/12'))
      expect(reponse?.headers.get('location')).toBe('http://localhost:3000/unauthorized')
    }
    expect(entrepriseDuCompte).not.toHaveBeenCalled()
    expect(lireOffreGestion).not.toHaveBeenCalled()
  })

  it('couvre aussi les POST : une action forgée vers une offre étrangère meurt en 404', async () => {
    recruteurConnecte()
    lireOffreGestion.mockResolvedValue(null)

    const post = new NextRequest('http://localhost:3000/recruteur/offres/12/editer', {
      method: 'POST',
      headers: { cookie: 'authjs.session-token=jeton-de-test' },
    })

    const reponse = await proxy(post)
    expect(reponse?.headers.get('x-middleware-rewrite')).toContain('/404')

    // Le même POST sur SON offre passe (la page/action revalide derrière).
    lireOffreGestion.mockResolvedValue({ id: 12 })
    expect(
      (await proxy(post))?.headers.get('x-middleware-next'),
    ).toBe('1')
  })
})
