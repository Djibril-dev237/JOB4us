import { NextResponse, type NextRequest } from 'next/server'
import { decode } from 'next-auth/jwt'

import type { Role } from '@/lib/definitions'

// ─── Routes protégées (optimistic check) ─────────────────────────────────────
// Chemins repris de legacy_laravel/routes/web.php (groupes middleware
// auth + candidat / recruteur / admin).
//
// NOTE Next.js 16 : middleware.ts est renommé proxy.ts (meme logique).
//
// Le Proxy fait uniquement une vérification OPTIMISTE (redirections rapides,
// sans accès base). Le contrôle autoritaire (session + rôle + compte actif
// en base) est refait par verifySession/verifyRole/getCurrentUser (dal.ts)
// dans chaque page/route protégée. Toute nouvelle route protégée doit donc
// être ajoutée ici POUR LE CONFORT mais surtout appeler le DAL côté rendu.
// ---------------------------------------------------------------------------

const ROLE_ROUTES: { prefix: string; roles: Role[] }[] = [
  { prefix: '/candidat', roles: ['candidat'] },
  { prefix: '/recruteur', roles: ['recruteur'] },
  { prefix: '/admin', roles: ['admin'] },
]

/** Routes ouvertes à tout utilisateur connecté (legacy: middleware auth seul). */
const AUTH_ROUTES = ['/messages', '/notifications', '/parametres']

function matchPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

// ─── Lecture du cookie de session Auth.js ────────────────────────────────────

interface ProxySession {
  userId: number
  role: Role
}

async function readSession(request: NextRequest): Promise<ProxySession | null> {
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

// ─── Proxy ───────────────────────────────────────────────────────────────────

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const session = await readSession(request)

  // Connecté : les pages d'auth sont redirigées vers l'accueil.
  if (session && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const roleRoute = ROLE_ROUTES.find((route) => matchPrefix(pathname, route.prefix))
  const needsAuthOnly = AUTH_ROUTES.some((route) => matchPrefix(pathname, route))

  if (!roleRoute && !needsAuthOnly) {
    return NextResponse.next()
  }

  // Non connecté → page de connexion.
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Rôle insuffisant → page d'accès refusé.
  // La politique est le rejet explicite (jamais de silence), y compris pour
  // un admin qui n'a pas de rôle attendu sur un espace métier.
  if (roleRoute && !roleRoute.roles.includes(session.role)) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
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
