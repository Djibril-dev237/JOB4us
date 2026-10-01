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

// ─── Schemas Zod — Profil candidat (M3) ──────────────────────────────────────

/**
 * Valeurs du champ « disponibilité » côté FORMULAIRE : les chaînes legacy de
 * la base (`1_mois`, `3_mois`), vérifiées sur la validation PHP du
 * ProfilController ET sur les @@map du schéma Prisma. Le formulaire parle en
 * valeurs legacy ; la conversion vers les énumérations Prisma passe par les
 * deux maps ci-dessous (jamais d'inversion silencieuse ailleurs).
 */
export const DISPONIBILITE_FORM = [
  'immediat',
  '1_mois',
  '3_mois',
  'non_disponible',
] as const

export type DisponibiliteForm = (typeof DISPONIBILITE_FORM)[number]

/** Valeurs TS de l'enum Prisma `Disponibilite` (schéma vérifié). */
export type DisponibilitePrisma = 'immediat' | 'un_mois' | 'trois_mois' | 'non_disponible'

export const DISPONIBILITE_VERS_PRISMA: Record<DisponibiliteForm, DisponibilitePrisma> = {
  immediat: 'immediat',
  '1_mois': 'un_mois',
  '3_mois': 'trois_mois',
  non_disponible: 'non_disponible',
}

export const DISPONIBILITE_VERS_FORM: Record<DisponibilitePrisma, DisponibiliteForm> = {
  immediat: 'immediat',
  un_mois: '1_mois',
  trois_mois: '3_mois',
  non_disponible: 'non_disponible',
}

/**
 * Mise à jour du profil candidat (M3) — reprend EXACTEMENT les champs
 * validés par le legacy ProfilController::update (vérifiés dans le PHP, pas
 * supposés) : user { name, phone, ville } + candidat { titre_profil, resume,
 * date_naissance, genre, disponibilite } + remplacement du jeu de
 * compétences. L'avatar et le CV ont leurs propres actions (uploadAvatar /
 * uploadCv).
 *
 * Politique anti mass-assign identique à M1 : raw construit par clés
 * explicites (le payload `role`, `id`, `password`… n'est JAMAIS lu) + `.strip()`
 * Zod (mode par défaut) en filet complémentaire.
 *
 * Durcisseurs assumés par rapport au legacy (commentés) :
 * - resume borné à 10 000 caractères (la colonne TEXT admettrait 64 Ko,
 *   aucune limite PHP n'existait) ;
 * - dateNaissance refusée dans le futur (la règle `date` legacy l'acceptait) ;
 * - competences bornées à 100 entrées (legacy : sync() non borné).
 */
export const ProfilCandidatSchema = z.object({
  // .trim() en tête : le middleware TrimStrings legacy validait sur la
  // chaîne déjà trimée (ordre des vérifications identique au PHP).
  name: z
    .string()
    .trim()
    .min(2, { error: 'Le nom doit contenir au moins 2 caractères.' })
    .max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s\-().]{8,20}$/, { error: 'Numéro de téléphone invalide.' })
    .optional()
    .or(z.literal('')),
  ville: z.string().trim().max(100, { error: 'La ville ne doit pas dépasser 100 caractères.' }).optional().or(z.literal('')),
  titreProfil: z
    .string()
    .trim()
    .max(150, { error: 'Le titre ne doit pas dépasser 150 caractères.' })
    .optional()
    .or(z.literal('')),
  resume: z
    .string()
    .trim()
    .max(10_000, { error: 'Le résumé ne doit pas dépasser 10 000 caractères.' })
    .optional()
    .or(z.literal('')),
  dateNaissance: z
    .iso.date({ error: 'Date de naissance invalide.' })
    .refine((value) => new Date(value) <= new Date(), {
      error: 'La date de naissance ne peut pas être dans le futur.',
    })
    .or(z.literal(''))
    .optional(),
  genre: z.enum(['homme', 'femme', 'autre']).optional().or(z.literal('')),
  disponibilite: z.enum(DISPONIBILITE_FORM).optional().or(z.literal('')),
  competences: z
    .array(z.coerce.number().int().positive())
    .max(100, { error: 'Trop de compétences sélectionnées (maximum 100).' }),
})

export type ProfilCandidatFormData = z.infer<typeof ProfilCandidatSchema>

// ─── Schemas Zod — Profil entreprise (M3-ST9) ────────────────────────────────

/**
 * Valeurs de la liste legacy `taille_entreprise` — validation PHP
 * `in:1-10,11-50,51-200,201-500,500+` vérifiée dans le contrôleur
 * EntrepriseController::update, pas supposée.
 */
export const TAILLE_ENTREPRISE_FORM = ['1-10', '11-50', '51-200', '201-500', '500+'] as const

/**
 * Mise à jour du profil Entreprise (M3-ST9) — les 10 champs exacts de
 * EntrepriseController::update (lue dans le PHP, pas supposés).
 *
 * ABSENTS VOLONTAIREMENT (mass-assign) : `logo` (action dédiée uploadLogo),
 * `isVerified` (colonne réservée à l'admin — le legacy ne l'y touchait pas
 * non plus), `id`/`userId`/horodatages. Raw construit par clés explicites +
 * .strip() Zod, politique identique à M1.
 *
 * Bornes assumées (durcissements documentés) :
 * - `description` : legacy sans limite (TEXT 64 Ko) → 10 000 caractères,
 *   comme le résumé candidat ;
 * - `site_web` / `adresse` : legacy max:200 mais les colonnes MySQL sans
 *   @db.VarChar valent VARCHAR(191) chez Prisma → 191 (insérable) ;
 * - `site_web` : la règle `url` legacy acceptait n'importe quel schéma
 *   valide — ici http(s) EXCLUSIVEMENT (un `javascript:` stocké deviendrait
 *   un XSS au clic une fois rendu en lien).
 */
export const EntrepriseSchema = z.object({
  // .trim() en tête, partout : parité exacte du TrimStrings legacy.
  nom: z
    .string()
    .trim()
    .min(1, { error: "Le nom de l'entreprise est requis." })
    .max(150, { error: "Le nom ne doit pas dépasser 150 caractères." }),
  secteurActivite: z
    .string()
    .trim()
    .max(150, { error: "Le secteur ne doit pas dépasser 150 caractères." })
    .optional()
    .or(z.literal('')),
  tailleEntreprise: z.enum(TAILLE_ENTREPRISE_FORM).optional().or(z.literal('')),
  description: z
    .string()
    .trim()
    .max(10_000, { error: 'La description ne doit pas dépasser 10 000 caractères.' })
    .optional()
    .or(z.literal('')),
  siteWeb: z
    .url({ error: 'URL de site web invalide.' })
    .refine((value) => /^https?:\/\//i.test(value), {
      error: 'Seuls les liens http(s) sont autorisés.',
    })
    .or(z.literal(''))
    .optional(),
  emailContact: z
    .email({ error: 'Adresse email de contact invalide.' })
    .max(150, { error: "L'email ne doit pas dépasser 150 caractères." })
    .optional()
    .or(z.literal('')),
  // Aucun format imposé : la règle legacy `telephone` n'était que max:20.
  telephone: z
    .string()
    .trim()
    .max(20, { error: 'Le téléphone ne doit pas dépasser 20 caractères.' })
    .optional()
    .or(z.literal('')),
  adresse: z
    .string()
    .trim()
    .max(191, { error: "L'adresse ne doit pas dépasser 191 caractères." })
    .optional()
    .or(z.literal('')),
  ville: z.string().trim().max(100, { error: 'La ville ne doit pas dépasser 100 caractères.' }).optional().or(z.literal('')),
  pays: z.string().trim().max(100, { error: 'Le pays ne doit pas dépasser 100 caractères.' }).optional().or(z.literal('')),
})

export type EntrepriseFormData = z.infer<typeof EntrepriseSchema>

// ─── FormState générique pour useActionState ─────────────────────────────────

export type FormState<T extends Record<string, unknown> = Record<string, string[]>> =
  | {
      errors?: Partial<Record<keyof T, string[]>> & { _form?: string[] }
      message?: string
    }
  | undefined
