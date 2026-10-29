import 'server-only'

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'

import { ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/admin-crypto'
import { verifierChallengeAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { LoginSchema, type Role } from '@/lib/definitions'
import {
  LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER,
  LOGIN_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
  resetAttempts,
} from '@/lib/rate-limit'

// ─── Migration des hash PHP (password_hash, bcrypt $2y$) ─────────────────────

/**
 * Migration des hash PHP password_hash() (bcrypt, préfixe $2y$).
 *
 * Test explicite réalisé (scripts/_tmp_test_bcrypt.cjs) :
 * - bcryptjs 3.0.3 accepte NATURELLEMENT le préfixe $2y$ (compare brut = true
 *   sur un hash requalifié $2y$), contrairement aux versions plus anciennes ;
 * - la normalisation $2y$ -> $2a$ est également vérifiée (bon mdp = true,
 *   mauvais mdp = false) et reste en place par robustesse : elle documente le
 *   format legacy et protège si la librairie de hash est remplacée un jour.
 * - NB : la base de dev ne contenait aucun hash PHP réel (2 utilisateurs de
 *   test en $2b$) — le round-trip $2y$ simulé couvre le chemin de vérification,
 *   le hash réel sera celui importé tel quel de MySQL en production.
 *
 * @param hash Hash stocké en base (users.password)
 */
export function normalizeBcryptHash(hash: string): string {
  return hash.startsWith('$2y$') ? `$2a$${hash.slice(4)}` : hash
}

/**
 * Hash bcrypt valide mais arbitraire, comparé lorsque le compte est absent ou
 * désactivé : le temps de réponse reste identique à une vraie vérification,
 * ce qui empêche de déduire l'existence d'un compte par mesure de timing
 * (le message d'erreur reste par ailleurs strictement générique).
 */
const TIMING_DECOY_HASH = '$2b$10$AnYHo7fxr3egsANmLJ1OTe.D1qGj0v/Q423J0p8YE1QiKDOdASE2.'

export async function verifyPassword(
  plainPassword: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash) {
    await bcrypt.compare(plainPassword, TIMING_DECOY_HASH)
    return false
  }
  return bcrypt.compare(plainPassword, normalizeBcryptHash(storedHash))
}

// ─── Autorisation des identifiants (testable hors NextAuth) ─────────────────
//
// Le provider credentials ordinaire REFUSE toujours un admin : sans cette
// barrière, un POST direct sur /api/auth/callback/credentials ouvrirait une
// session sans second facteur. L'action de connexion admin crée un challenge
// séparé, consommé par le provider `admin-challenge`.

export interface UtilisateurAutorise {
  id: string
  name: string
  email?: string
  role: Role
  sessionVersion: number
}

export async function autoriserIdentifiants(
  credentials: unknown,
): Promise<UtilisateurAutorise | null> {
  const parsed = LoginSchema.safeParse(credentials)
  if (!parsed.success) return null

  const { identifier, password } = parsed.data

  // Rate limiting PAR IDENTIFIANT placé ici et non dans l'action :
  // authorize() est le point de passage unique de tout essai
  // credentials (formulaire OU POST direct sur
  // /api/auth/callback/credentials), impossible à contourner.
  // (La limite par IP, elle, nécessite les headers : côté action.)
  const idKey = `login:id:${identifier.toLowerCase()}`
  const idLimit = checkRateLimit(idKey, LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER, LOGIN_WINDOW_MS)
  if (!idLimit.allowed) return null

  // Login par email OU téléphone (compatible legacy PHP).
  // MySQL : collation utf8mb4_unicode_ci, comparaison insensible
  // à la casse pour l'email.
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      isActive: true,
      anonymizedAt: true,
      sessionVersion: true,
    },
  })

  // Compte absent, désactivé ou anonymisé : comparaison factice,
  // réponse nulle, tentative comptée (comportement identique à un
  // mauvais mot de passe : aucune fuite sur l'existence du compte).
  if (!user || !user.isActive || user.anonymizedAt !== null) {
    await verifyPassword(password, null)
    recordAttempt(idKey)
    return null
  }

  // Un admin ne peut JAMAIS ouvrir une session par le provider
  // credentials ordinaire : le POST direct sur
  // /api/auth/callback/credentials contournerait le second facteur.
  // La vérification du mot de passe est tout de même effectuée pour
  // garder un temps de réponse comparable, puis la tentative est
  // comptée. L'action de connexion admin crée le challenge séparément.
  if (user.role === 'admin') {
    await verifyPassword(password, user.password)
    recordAttempt(idKey)
    return null
  }

  const valid = await verifyPassword(password, user.password)
  if (!valid) {
    recordAttempt(idKey)
    return null
  }

  // Connexion réussie : fenêtre de cet identifiant libérée.
  resetAttempts(idKey)

  // Aucun hash de mot de passe n'est retourné ni journalisé :
  // seuls les champs non sensibles alimentent la session.
  return {
    id: String(user.id),
    name: user.name,
    email: user.email ?? undefined,
    role: user.role,
    sessionVersion: user.sessionVersion,
  }
}

export async function autoriserChallengeAdmin(
  credentials: unknown,
): Promise<UtilisateurAutorise | null> {
  // Le jeton de challenge est passé par la Server Action depuis le
  // cookie httpOnly : il n'est jamais exposé au formulaire client.
  const valeurs =
    credentials && typeof credentials === 'object'
      ? (credentials as Record<string, unknown>)
      : {}
  return verifierChallengeAdmin({
    challengeToken: valeurs.challengeToken,
    code: valeurs.code,
  })
}

// ─── Claims JWT (testables hors NextAuth) ───────────────────────────────────

export interface UtilisateurJwt {
  id?: string
  role?: Role
  sessionVersion?: number
}

export function appliquerClaimsJwt<
  T extends {
    userId?: number
    role?: Role
    sessionVersion?: number
    exp?: number
  },
>(token: T, user?: UtilisateurJwt | null): T {
  if (user) {
    const identifiant = Number(user.id)
    if (Number.isInteger(identifiant) && identifiant > 0) {
      token.userId = identifiant
    }
    token.role = user.role
    token.sessionVersion =
      typeof user.sessionVersion === 'number' ? user.sessionVersion : 0
    // Session admin plafonnée à 8 h, indépendamment du maximum global
    // de 7 jours. Un admin doit se reconnecter avec TOTP chaque jour
    // ouvré ; le cookie peut survivre, le jeton serveur non.
    if (user.role === 'admin') {
      token.exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS
    }
  }
  return token
}

// ─── Configuration NextAuth (Auth.js) ────────────────────────────────────────

export const { handlers, auth, signIn, signOut } = NextAuth({
  /**
   * L'adapter Prisma est conservé (tables accounts/sessions/verification_tokens
   * en base) pour d'éventuels providers OAuth futures. Il ne participe PAS à la
   * session du provider credentials : la branche credentials d'Auth.js
   * (@auth/core lib/actions/callback/index.js) crée exclusivement un cookie de
   * session JWT, strategy "database" serait donc inopérante ici.
   */
  adapter: PrismaAdapter(prisma),

  // Cookie de session JWT, durée calquée sur l'ancienne session (7 jours).
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
  },

  // Redirections de connexion centralisées sur notre page /login.
  pages: { signIn: '/login' },

  // Requêtes derrière un reverse proxy / en dev local acceptées.
  // En production, définir AUTH_URL et retirer cette option si l'on veut
  // imposer un hôte explicite.
  trustHost: true,

  providers: [
    Credentials({
      credentials: {
        identifier: { label: 'Email ou téléphone', type: 'text' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      authorize: autoriserIdentifiants,
    }),
    Credentials({
      id: 'admin-challenge',
      name: 'Admin challenge',
      credentials: {
        challengeToken: { label: 'Challenge', type: 'text' },
        code: { label: "Code d'authentification", type: 'text' },
      },
      authorize: autoriserChallengeAdmin,
    }),
  ],

  callbacks: {
    // À la connexion (user présent) : on fige l'id et le rôle dans le token.
    // Les changements de rôle / désactivations sont ensuite contrôlés par
    // getCurrentUser() (dal.ts) qui revérifie la base à chaque rendu protégé.
    async jwt({ token, user }) {
      return appliquerClaimsJwt(token, user)
    },

    // Exposition de l'id et du rôle au reste de l'application.
    // Note de typage Auth.js : params.session est un intersection
    // (branche database | branche jwt confondues) où AdapterUser.id: string
    // croise notre id: number (→ never). Reconstruire l'objet via spread
    // remplace proprement la propriété au lieu d'affecter sur l'intersection.
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: typeof token.userId === 'number' ? token.userId : undefined,
          role: typeof token.role === 'string' ? token.role : undefined,
          sessionVersion:
            typeof token.sessionVersion === 'number' ? token.sessionVersion : undefined,
        },
      }
    },
  },
})
