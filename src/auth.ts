import 'server-only'

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'

import { prisma } from '@/lib/prisma'
import { LoginSchema } from '@/lib/definitions'

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

async function verifyPassword(plainPassword: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) {
    await bcrypt.compare(plainPassword, TIMING_DECOY_HASH)
    return false
  }
  return bcrypt.compare(plainPassword, normalizeBcryptHash(storedHash))
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
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const { identifier, password } = parsed.data

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
          },
        })

        // Compte absent ou désactivé : comparaison factice, réponse nulle.
        if (!user || !user.isActive) {
          await verifyPassword(password, null)
          return null
        }

        const valid = await verifyPassword(password, user.password)
        if (!valid) return null

        // Aucun hash de mot de passe n'est retourné ni journalisé :
        // seuls les champs non sensibles alimentent la session.
        return {
          id: String(user.id),
          name: user.name,
          email: user.email ?? undefined,
          role: user.role,
        }
      },
    }),
  ],

  callbacks: {
    // À la connexion (user présent) : on fige l'id et le rôle dans le token.
    // Les changements de rôle / désactivations sont ensuite contrôlés par
    // getCurrentUser() (dal.ts) qui revérifie la base à chaque rendu protégé.
    async jwt({ token, user }) {
      if (user) {
        token.userId = Number(user.id)
        token.role = user.role
      }
      return token
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
        },
      }
    },
  },
})
