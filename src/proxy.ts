import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { slugOffreVisible } from '@/lib/offres-public'
import {
  OFFRES_MAX_REQUESTS_PER_IP,
  OFFRES_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'

// ─── Rate limit du périmètre public M5 (task 10) ─────────────────────────────
//
// Convention Next 16 : le fichier `middleware.ts` est DÉPRÉCIÉ et renommé
// `proxy.ts` (doc officielle : « Middleware is deprecated and renamed to
// Proxy », v16.0.0) — export `proxy` + config.matcher, runtime Node par
// défaut (aucun réglage requis).
//
// Périmètre couvert (matcher plus bas) : pages /offres, fiche /offres/<slug>,
// /sitemap.xml et /api/files/logo — les quatre points d'entrée qui
// déclenchent des requêtes base côté public. Les endpoints /api/home/* (M2)
// sont HORS périmètre : leurs en-têtes `public, max-age=60, s-maxage=60`
// déjà livrés absorbent l'origine côté CDN.
//
// Store : celui de M1 (src/lib/rate-limit.ts, fenêtre glissante en mémoire,
// périmètre monoprocessus déjà documenté là-bas). Les clés `offres:ip:*`
// sont disjointes des clés `login:*` : aucun croisement de budget entre la
// connexion et la lecture publique. Le store ne vit QUE dans ce proxy pour
// ces clés — la mise en garde de la doc Next (« ne pas reposer sur des
// modules/globaux partagés entre proxy et rendu ») est donc respectée : le
// proxy et les pages ne coordonnent rien.
//
// IP : même extraction que M1 (x-forwarded-for, puis x-real-ip). DIVERGENCE
// assumée face au `'local'` de M1 : sans en-tête identifiable, on ne
// limite PAS (fail-open). Chez M1, un compte partagé `'local'` à 5
// tentatives reste défendable ; ici, un seau unique à 120 req/min pour
// tous les clients sans en-tête permettrait à UN visiteur d'épuiser le
// budget de TOUS les autres (auto-DoS) — et en dev direct (aucun proxy),
// aucun en-tête n'existe, ce qui casserait la validation navigateur.
// Modèle de confiance : x-forwarded-for n'est fiable que derrière un
// proxy qui le RÉÉCRIT (Vercel, Cloudflare, nginx avec proxy_set_header) ;
// en exposition directe, un client peut le falsifier (contourner ou
// épuiser un seau d'autrui). Risque accepté et documenté, identique à M1 :
// le plafond reste dissuasif et la protection est pleinement correcte
// derrière le proxy de déploiement.
//
// Budget : 120 requêtes/min/IP sur TOUT le périmètre — 2 requêtes/s
// soutenues, très au-dessus de tout usage humain (navigation + prefetch),
// très en deçà d'un automate de scraping (pages/s). Réponse : 429 +
// Retry-After ; page HTML minimaliste pour les navigateurs (noindex, hors
// pipeline de tokens M2 — couleurs système par défaut, AUCUNE couleur
// inventée), JSON `{ error }` pour les API, au format des autres erreurs
// du projet.
//
// ─── 404 réel des fiches invisibles (task 10b, validé en fin M5) ─────────────
//
// Critère M5 : « brouillon/expirée/supprimée → 404 » sur URL directe.
// Mesure de validation : en Next 16, `notFound()` de la PAGE répond
// TOUJOURS 200 (corps not-found + noindex injecté) — le stream démarre
// avant la résolution de la page (doc not-found.js : « 200 for streamed
// responses, 404 for non-streamed »), que le squelette loading.tsx soit
// présent ou non et que notFound() soit synchrone (les trois variantes
// mesurées → 200 ; seul le noindex protège le SEO). Seules les URL non
// appariées, où le ROUTING tranche avant tout rendu, retournent 404
// strict.
//
// Prescription officielle (loading.md §Status codes) : « ensure the
// resource exists before the response body is streamed … run this check
// in proxy to rewrite missing slugs to a not-found route ». Le proxy est
// l'étape 3 de l'exécution Next (routes = étape 5) : aucun octet n'a été
// engagé au moment du contrôle, le 404 est donc ferme.
//
// Déroulé : rate limit D'ABORD (il protège aussi la base) → GET/HEAD sur
// /offres/<slug> uniquement → slugOffreVisible (regex non conforme = 0
// requête ; sinon 1 requête `id` avec le prédicat unique) → absent ou
// invisible → rewrite vers /404 (URL volontairement sans route) →
// routing non apparié → 404 strict du not-found M2, l'URL d'origine
// reste affichée dans le navigateur.
//
// La PAGE garde son propre notFound() (défense en profondeur : si ce
// contrôle saute un jour, la page affiche quand même le même not-found) :
// si une offre expire entre le contrôle et le rendu (fenêtre de quelques
// ms), le visiteur reçoit le not-found en 200 noindex — course
// documentée, non éliminable sans sacrifier le streaming.
//
// Coût : +1 requête indexée par fiche consultée, bornée à 120/min/IP par
// le rate limit ci-dessus. Fail-open sans IP conservé : le contrôle 404
// s'exécute aussi quand aucune IP n'est exploitable (il n'appartient pas
// au rate limit).
// ---------------------------------------------------------------------------

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

/**
 * Contrôle de visibilité AVANT rendu (task 10b) : neutre en dehors des
 * GET/HEAD de fiche ; rewrite vers `/404` (URL volontairement sans
 * route) quand le slug est absent, expiré, brouillon, recruteur suspendu
 * ou non conforme — le routing pose alors le 404 strict, mécanisme
 * identique à toute URL inconnue, sans dupliquer l'UI d'état.
 */
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

export async function proxy(
  request: NextRequest,
): Promise<NextResponse | undefined> {
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

export const config = {
  matcher: ['/offres/:path*', '/sitemap.xml', '/api/files/logo'],
}
