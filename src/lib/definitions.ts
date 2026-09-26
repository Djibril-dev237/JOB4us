import { z } from 'zod'

// ─── Rôles ───────────────────────────────────────────────────────────────────

export type Role = 'candidat' | 'recruteur' | 'admin'

// ─── Session ─────────────────────────────────────────────────────────────────

export interface SessionPayload {
  userId: number
  role: Role
  expiresAt: Date
}

// ─── Schemas Zod — Auth ───────────────────────────────────────────────────────

/** Connexion : email OU téléphone + mot de passe */
export const LoginSchema = z.object({
  identifier: z
    .string()
    .min(1, { error: 'Email ou téléphone requis.' })
    .trim(),
  password: z.string().min(1, { error: 'Mot de passe requis.' }),
})

export type LoginFormData = z.infer<typeof LoginSchema>

/** Inscription candidat */
export const RegisterCandidatSchema = z
  .object({
    name: z
      .string()
      .min(2, { error: 'Le nom doit contenir au moins 2 caractères.' })
      .max(100)
      .trim(),
    email: z.email({ error: 'Adresse email invalide.' }).trim(),
    phone: z
      .string()
      .regex(/^\+?[\d\s\-().]{8,20}$/, { error: 'Numéro de téléphone invalide.' })
      .optional()
      .or(z.literal('')),
    password: z
      .string()
      .min(8, { error: 'Le mot de passe doit contenir au moins 8 caractères.' })
      .max(128),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Les mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })

export type RegisterCandidatFormData = z.infer<typeof RegisterCandidatSchema>

/** Inscription recruteur */
export const RegisterRecruteurSchema = z
  .object({
    name: z
      .string()
      .min(2, { error: 'Le nom doit contenir au moins 2 caractères.' })
      .max(100)
      .trim(),
    email: z.email({ error: 'Adresse email invalide.' }).trim(),
    phone: z
      .string()
      .regex(/^\+?[\d\s\-().]{8,20}$/, { error: 'Numéro de téléphone invalide.' })
      .optional()
      .or(z.literal('')),
    password: z
      .string()
      .min(8, { error: 'Le mot de passe doit contenir au moins 8 caractères.' })
      .max(128),
    confirmPassword: z.string(),
    entrepriseName: z
      .string()
      .min(2, { error: 'Le nom d\'entreprise doit contenir au moins 2 caractères.' })
      .max(200)
      .trim(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Les mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  })

export type RegisterRecruteurFormData = z.infer<typeof RegisterRecruteurSchema>

/**
 * Rôles d'inscription autorisés.
 * "admin" est VOLONTAIREMENT absent : la création de compte admin n'est pas
 * exposée publiquement (les comptes admin existants sont créés hors ligne,
 * voir legacy : AdminSeeder).
 */
export type RegisterRole = 'candidat' | 'recruteur'

/** Données du formulaire d'inscription unique (rôle choisi dans le formulaire). */
export type RegisterFormData = RegisterCandidatFormData & {
  entrepriseName?: string
}

// ─── Schemas Zod — Mise à jour de profil (whitelist anti-mass-assignment) ────

/**
 * Champs AUTORISÉS à être modifiés par un utilisateur sur son propre profil.
 * Les champs sensibles (role, id, isActive, password) sont volontairement
 * absents : Zod les supprime silencieusement en mode .strip() (défaut).
 */
export const UpdateProfileSchema = z.object({
  name: z
    .string()
    .min(2, { error: 'Le nom doit contenir au moins 2 caractères.' })
    .max(100)
    .trim()
    .optional(),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-().]{8,20}$/, { error: 'Numéro de téléphone invalide.' })
    .optional()
    .or(z.literal('')),
})

export type UpdateProfileData = z.infer<typeof UpdateProfileSchema>

// ─── FormState générique pour useActionState ─────────────────────────────────

export type FormState<T extends Record<string, unknown> = Record<string, string[]>> =
  | {
      errors?: Partial<Record<keyof T, string[]>> & { _form?: string[] }
      message?: string
    }
  | undefined
