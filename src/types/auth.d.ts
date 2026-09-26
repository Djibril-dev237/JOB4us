import type { DefaultSession } from '@auth/core/types'

import type { Role } from '@/lib/definitions'

// Augmentation des types Auth.js déclarés par @auth/core (next-auth ne fait
// que les re-exporter : c'est le module déclarant qu'il faut augmenter).

declare module '@auth/core/types' {
  interface User {
    /** Rôle porté par le provider credentials (non stocké en base). */
    role?: Role
  }

  interface Session {
    /**
     * id et role injectés par le callback `session` (src/auth.ts).
     * Absents si le token JWT ne porte pas ces claims (cookie ancien) :
     * les gardes dal.ts traitent alors la session comme non connectée.
     *
     * Omit<'id'> est nécessaire : DefaultUser déclare id?: string,
     * notre id est number → sans exclusion, l'intersection donne never.
     */
    user: {
      id?: number
      role?: Role
    } & Omit<NonNullable<DefaultSession['user']>, 'id'>
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    userId?: number
    role?: Role
  }
}
