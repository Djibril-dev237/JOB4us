import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decode } from 'next-auth/jwt'

import type { Role } from '@/lib/definitions'
import { slugOffreVisible } from '@/lib/offres-public'
import {
  OFFRES_MAX_REQUESTS_PER_IP,
  OFFRES_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'

// ─── Proxy à trois couches (P0 M6 : fusion M1 + M5) ──────────────────────────
//
// Convention Next 16 : `middleware.ts` est DÉPRÉCIÉ et renommé `proxy.ts`
// (doc officielle : « Middleware is deprecated and renamed to Proxy »,
// v16.0.0) — export `proxy` + config.matcher, runtime Node par défaut.
//
// COUCHE 1 — Rate limit du périmètre public (M5 task 10) :
// 120 req/min/IP sur les points d'entrée publics qui déclenchent des
// requêtes base (/offres, fiche /offres/<slug>, /sitemap.xml,
// /api/files/logo). Il ne s'applique PLUS à tout le matcher : les
// espaces connectés (/recruteur…) ont leur propre budget de session et
// n'ont jamais eu de limite en M1 — un recruteur qui navigue ne doit
// pas épuiser le seau public partagé (et inversement). Store : celui de
// M1 (src/lib/rate-limit.ts, fenêtre glissante en mémoire, périmètre
// monoprocessus déjà documenté là-bas). Les clés `offres:ip:*` restent
// disjointes de `login:*`. IP : x-forwarded-for puis x-real-ip ;
// fail-open sans IP (documenté en M5 : sans en-tête identifiable, un
// seau unique auto-DOSerait tous les clients en dev direct).
// Réponse 429 : Retry-After + page HTML minimaliste noindex (navigateurs)
// ou JSON `{ error }` (API), au format des autres erreurs du projet.
//
// COUCHE 2 — Gate par rôle, contrôle OPTIMISTE (M1, restauré en M6 P0) :
// lecture du cookie JWT Auth.js sans base, redirections rapides
// /login (visiteur) et /unauthorized (rôle insuffisant), + redirection
// /login→/ pour un connecté. RESTAURÉ car le commit M5 `7a4aade` avait
// réécrit ce fichier en entier et perdu cette couche (diagnostic M6
// addendum : les pages du groupe (app) sont synchrones et s'appuyaient
// dessus, aucune ne rappelle verifyRole au rendu). Le contrôle
// AUTORITAIRE reste le DAL (verifySession/verifyRole/getCurrentUser,
// dal.ts) exécuté dans chaque page/action protégée — ce proxy n'est que
// la redirection confort. Politique : rejet explicite, jamais de silence,
// y compris pour un admin sur un espace métier qui n'est pas le sien.
//
// COUCHE 3 — 404 pré-streaming des fiches (M5 task 10b) :
// en Next 16, `notFound()` de la PAGE répond TOUJOURS 200 (corps stream
// démarré avant la résolution — doc not-found.js « 200 for streamed
// responses ») ; seul le ROUTING sur une URL non appariée pose 404
// strict. D'où : GET/HEAD /offres/<slug> → slugOffreVisible (regex en
// entrée = 0 requête si non conforme) → absent/invisible → rewrite vers
// /404 (URL sans route) → 404 strict du not-found M2, URL d'origine
// conservée. Prescription : loading.md §Status codes « run this check in
// proxy to rewrite missing slugs to a not-found route ». La PAGE garde
// son propre notFound() en défense (course documentée, non éliminable
// sans sacrifier le streaming).
//
// ORDRE : rate limit d'abord (il protège aussi la base) → contrôle 404
// sur le périmètre public ; gate par rôle sur les espaces connectés
// (domaines disjoints — aucun croisement possible). Le décodage JWT
// n'a lieu QUE sur les chemins de gate : un visiteur sur /offres ne paie
// aucun coût de décodage.
// ---------------------------------------------------------------------------

// ─── Couche 2 : routes protégées (optimistic check, héritage M1) ─────────────
// Chemins repris de legacy_laravel/routes/web.php (groupes middleware
// auth + candidat / recruteur / admin). Toute nouvelle route protégée
// doit être ajoutée ICI et surtout appeler le DAL côté rendu.

const ROLE_ROUTES: { prefix: string; roles: Role[] }[] = [
  { prefix: '/candidat', roles: ['candidat'] },
  { prefix: '/recruteur', roles: ['recruteur'] },
  { prefix: '/admin', roles: ['admin'] },
]

/** Routes ouvertes à tout utilisateur connecté (legacy : middleware auth seul). */
const AUTH_ROUTES = ['/messages', '/notifications', '/parametres']

function correspondPrefixe(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Pages d'authentification : un connecté est renvoyé à l'accueil. */
function estPageAuth(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register'
}

// ─── Couche 1 : périmètre public soumis au rate limit ────────────────────────

/**
 * Même étendue que le matcher M5 (`/offres/:path*`, `/sitemap.xml`,
 * `/api/files/logo`) : le budget `offres:ip:*` ne touche jamais les
 * espaces connectés. `startsWith('/offres/')` (et non `startsWith`) pour
 * ne pas attraper un chemin tel que /offres-ancien.
 */
function estPerimetrePublic(pathname: string): boolean {
  return (
    pathname === '/offres' ||
    pathname.startsWith('/offres/') ||
    pathname === '/sitemap.xml' ||
    pathname === '/api/files/logo'
  )
}

/**
 * Adresse IP du client. `null` = aucune identité exploitable → fail-open
 * (voir l'en-tête du fichier).
 */
function extraireIp(request: NextRequest): string | null {
  const premiere = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (premiere !== undefined && premiere !== '') return premiere
  const reel = request.headers.get('x-real-ip')?.trim()
  if (reel !== undefined && reel !== '') return reel
  return null
}

/** Page 429 HTML autonome (le proxy s'exécute AVANT tout rendu App). */
function page429(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Trop de requêtes | Job4Us</title>
</head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif">
<main style="text-align:center;padding:24px">
<h1 style="font-size:1.5rem">Trop de requêtes</h1>
<p>Vous avez envoyé trop de demandes en peu de temps.</p>
<p>Réessayez dans quelques instants.</p>
</main>
</body>
</html>`
}

function reponseTropDeRequetes(
  request: NextRequest,
  retryAfterMs: number,
): NextResponse {
  const secondes = String(Math.max(Math.ceil(retryAfterMs / 1000), 1))
  const entetes = { 'Retry-After': secondes }
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    return new NextResponse(page429(), {
      status: 429,
      headers: { ...entetes, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  return NextResponse.json(
    { error: 'Trop de requêtes.' },
    { status: 429, headers: entetes },
  )
}

// ─── Couche 2 : lecture du cookie de session Auth.js ─────────────────────────

interface SessionProxy {
  userId: number
  role: Role
}

async function lireSession(request: NextRequest): Promise<SessionProxy | null> {
  const cookie =
    request.cookies.get('authjs.session-token') ??
    request.cookies.get('__Secure-authjs.session-token')
  if (!cookie) return null

  const secret = process.env.AUTH_SECRET
  if (!secret) return null

  try {
    // salt = nom exact du cookie (dérivation de clé Auth.js).
    const payload = await decode({ token: cookie.value, secret, salt: cookie.name })
    const userId = payload?.userId
    const role = payload?.role

    if (typeof userId !== 'number') return null
    if (role !== 'candidat' && role !== 'recruteur' && role !== 'admin') return null
    return { userId, role }
  } catch {
    // Cookie absent, expiré, altéré ou révoqué : non connecté.
    return null
  }
}

/**
 * Gate optimiste : aucune requête base, décodage JWT seul. Redirections
 * /login (visiteur), /unauthorized (rôle insuffisant), / (connecté sur
 * une page d'auth). `undefined` = chemin hors gate → couche suivante.
 */
async function controlerAccesEspace(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  const { pathname } = request.nextUrl
  const routeRole = ROLE_ROUTES.find((route) => correspondPrefixe(pathname, route.prefix))
  const authSeul = AUTH_ROUTES.some((route) => correspondPrefixe(pathname, route))
  const pageAuth = estPageAuth(pathname)
  if (routeRole === undefined && !authSeul && !pageAuth) return undefined

  const session = await lireSession(request)

  if (pageAuth) {
    return session !== null
      ? NextResponse.redirect(new URL('/', request.url))
      : undefined
  }

  // Non connecté → page de connexion.
  if (session === null) return NextResponse.redirect(new URL('/login', request.url))

  // Rôle insuffisant → page d'accès refusé (politique : rejet explicite).
  if (routeRole !== undefined && !routeRole.roles.includes(session.role)) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return NextResponse.next()
}

// ─── Couche 3 : contrôle de visibilité AVANT rendu (M5 task 10b) ─────────────
// Neutre en dehors des GET/HEAD de fiche ; rewrite vers `/404` (URL
// volontairement sans route) quand le slug est absent, expiré, brouillon,
// recruteur suspendu ou non conforme — le routing pose alors le 404
// strict, mécanisme identique à toute URL inconnue.
async function controlerFichePublique(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined

  const correspondance = /^\/offres\/([^/]+)\/?$/.exec(request.nextUrl.pathname)
  if (correspondance === null) return undefined

  const slug = correspondance[1] ?? ''
  if (await slugOffreVisible(slug)) return undefined

  return NextResponse.rewrite(new URL('/404', request.url))
}

// ─── Proxy ───────────────────────────────────────────────────────────────────

export async function proxy(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  // Périmètre public : rate limit d'abord (il protège aussi la base),
  // puis 404 pré-streaming des fiches.
  if (estPerimetrePublic(request.nextUrl.pathname)) {
    const ip = extraireIp(request)
    if (ip !== null) {
      const cle = `offres:ip:${ip}`
      const verif = checkRateLimit(
        cle,
        OFFRES_MAX_REQUESTS_PER_IP,
        OFFRES_WINDOW_MS,
      )
      if (!verif.allowed) return reponseTropDeRequetes(request, verif.retryAfterMs)
      recordAttempt(cle)
    }
    return controlerFichePublique(request)
  }

  // Espaces connectés : gate par rôle optimiste (aucun coût sur le
  // périmètre public ci-dessus — domaines disjoints).
  return controlerAccesEspace(request)
}

export const config = {
  matcher: [
    // Périmètre public M5 (rate limit + 404 fiches).
    '/offres/:path*',
    '/sitemap.xml',
    '/api/files/logo',
    // Espaces connectés M1 (gate par rôle, restauré en M6 P0).
    '/login',
    '/register',
    '/candidat/:path*',
    '/recruteur/:path*',
    '/admin/:path*',
    '/messages/:path*',
    '/notifications/:path*',
    '/parametres/:path*',
  ],
}
