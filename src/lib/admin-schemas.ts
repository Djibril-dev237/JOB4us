import { z } from 'zod'

// ─── Schémas des formulaires admin (M10) ─────────────────────────────────────
//
// Même doctrine que definitions.ts : la forme est validée au bord du serveur,
// les clés inconnues sont refusées, les valeurs sensibles ne sont jamais lues
// depuis un objet brut. L'autorisation reste dans les actions/DAL.
// ---------------------------------------------------------------------------

const JETON_ADMIN = /^[A-Za-z0-9_-]{20,200}$/
const SECRET_TOTP = /^[A-Z2-7]{16,64}$/
const CODE_TOTP = /^[0-9]{6}$/

export const ActivationAdminSchema = z
  .object({
    token: z
      .string()
      .regex(JETON_ADMIN, { error: "Lien d'activation invalide." }),
    secret: z.string().regex(SECRET_TOTP, { error: 'Secret TOTP invalide.' }),
    password: z
      .string()
      .min(12, {
        error: 'Le mot de passe doit contenir au moins 12 caractères.',
      })
      .max(128, { error: 'Le mot de passe est trop long.' })
      .regex(/[a-z]/, {
        error: 'Le mot de passe doit contenir une minuscule.',
      })
      .regex(/[A-Z]/, {
        error: 'Le mot de passe doit contenir une majuscule.',
      })
      .regex(/[0-9]/, {
        error: 'Le mot de passe doit contenir un chiffre.',
      }),
    confirmPassword: z.string(),
    code: z.string().regex(CODE_TOTP, {
      error: "Le code d'authentification doit contenir 6 chiffres.",
    }),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Les mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })

export type ActivationAdminFormData = z.infer<typeof ActivationAdminSchema>

/** Second facteur : 6 chiffres TOTP ou code de récupération de 10 caractères. */
export const CodeAdminSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, { error: "Saisissez un code d'authentification." })
    .max(32, { error: "Le code d'authentification est trop long." }),
})

export type CodeAdminFormData = z.infer<typeof CodeAdminSchema>
