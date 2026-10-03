import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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

export function proxy(request: NextRequest): NextResponse | undefined {
  const ip = extraireIp(request)
  if (ip === null) return undefined

  const cle = `offres:ip:${ip}`
  const verif = checkRateLimit(cle, OFFRES_MAX_REQUESTS_PER_IP, OFFRES_WINDOW_MS)
  if (!verif.allowed) return reponseTropDeRequetes(request, verif.retryAfterMs)

  recordAttempt(cle)
  return undefined
}

export const config = {
  matcher: ['/offres/:path*', '/sitemap.xml', '/api/files/logo'],
}
