import { z } from 'zod'

import type { NiveauExperience, TypeContrat } from '@prisma/client'

import { texteSansBalises } from '@/lib/texte'

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

// ─── Libellés d'offres (M5) ───────────────────────────────────────────────────
// Valeurs des enums Prisma → affichage FR. Les libellés sont empruntés AUX
// OPTIONS DU SELECT legacy (offres/index.blade.php) : les tags du blade
// affichaient la valeur brute du champ (« stage », et ucfirst → « Sans_experience »)
// — artefacts d'affichage non portés (décision M5, parité sur le copy propre).

export const TYPE_CONTRAT_LABELS: Record<TypeContrat, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  stage: 'Stage',
  freelance: 'Freelance',
  temps_partiel: 'Temps partiel',
}

export const NIVEAU_EXPERIENCE_LABELS: Record<NiveauExperience, string> = {
  sans_experience: 'Sans expérience',
  junior: 'Junior',
  intermediaire: 'Intermédiaire',
  senior: 'Senior',
}

// ─── Filtres de la liste publique des offres (M5, task 3) ────────────────────
//
// Schéma de l'URL partageable /offres?q=&ville=&categorie=&type_contrat=
// &niveau=&page= — noms de paramètres identiques au legacy
// (OffrePubliqueController@index lit request('type_contrat') et cie).
// Les tuples ci-dessous reflètent les enums Prisma : un test
// (definitions.test.ts) verrouille leur égalité avec Object.values(...) du
// client Prisma — anti-divergence. Aucun import RUNTIME de @prisma/client
// ici : ce module est aussi importé côté client (le type suffit).
//
// Philosophie : paramètre absent, vide ou invalide → FILTRE IGNORÉ, jamais
// d'erreur. Justification : les selects ne peuvent émettre que des valeurs
// valides, donc un paramètre invalide vient forcément d'une URL corrompue ;
// l'ignorer garde l'affichage cohérent (select sur « Toutes » + liste non
// filtrée) alors que le comparer tel quel produirait 0 résultat avec un
// select désynchronisé (le legacy where('type_contrat', 'xyz') rendait
// vide — comportement non reproduit, choix assumé).
// Les bornes de longueur sont un durcissement d'entrée : q ≤ 200 (colonne
// titre VarChar(200)), ville ≤ 100 (colonne VarChar(100)) — aucune valeur
// raisonnable n'est tronquée. `categorie`/`page` passent par Number() :
// un tableau (paramètre répété) ou un non-numérique → NaN → ignoré.

export const TYPE_CONTRAT_VALUES = [
  'CDI',
  'CDD',
  'stage',
  'freelance',
  'temps_partiel',
] as const

export const NIVEAU_EXPERIENCE_VALUES = [
  'sans_experience',
  'junior',
  'intermediaire',
  'senior',
] as const

export const OffresQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  ville: z.string().trim().min(1).max(100).optional().catch(undefined),
  categorie: z.coerce.number().int().min(1).optional().catch(undefined),
  type_contrat: z.enum(TYPE_CONTRAT_VALUES).optional().catch(undefined),
  niveau: z.enum(NIVEAU_EXPERIENCE_VALUES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(1),
})

/**
 * Valeurs validées d'une URL /offres : `page` est undefined si absente (le
 * DAL vaut alors 1) et ramenée à 1 si invalide ; les autres champs sont
 * undefined quand absents ou invalides.
 */
export type OffresQuery = z.infer<typeof OffresQuerySchema>

// ─── FormState générique pour useActionState ─────────────────────────────────

export type FormState<T extends Record<string, unknown> = Record<string, string[]>> =
  | {
      errors?: Partial<Record<keyof T, string[]>> & { _form?: string[] }
      message?: string
    }
  | undefined

// ─── Schemas Zod — Formulaire d’offre recruteur (M6) ─────────────────────────
//
// LISTE BLANCHE anti mass-assignment (critère M6) : les clés ci-dessous sont
// EXACTEMENT les noms des inputs de recruteur/offres/{create,edit}.blade.php
// (lues dans le blade et le contrôleur legacy, jamais supposées) + `intention`,
// seule innovation du contrat d’écran M6. Le schéma ne contient — et ne peut
// donc PAS produire — aucune de ces clés : `statut`, `is_active`/`isActive`
// (colonnes supprimées en M6), `id`, `slug`, `entreprise_id`/`entrepriseId`,
// `vues`, `deleted_at`/`deletedAt`, `created_at`, `updated_at`.
// Zod .strip() (mode objet par défaut) écarte les clés inconnues du payload :
// un test le vérifie réellement (`statut: 'publiee'` injecté ne ressort pas),
// et l’écriture serveur se fera par clés explicites (jamais `…parsed.data`
// étalé sur une écriture qui accepterait d’autres champs).
//
// TRAITEMENT DES TEXTES : `.transform(texteSansBalises)` (retire les balises)
// puis `.trim()` ET les bornes dans le tube suivant — mesurer APRÈS nettoyage,
// pour qu’un champ réduit à « <b></b> » échoue sur le min plutôt que de passer
// pour du contenu. Aucune entité n’est décodée (voir texte.ts).
//
// Durcissements assumés vs legacy (OffreController::store ne validait que
// `required|string|max:200` sur le titre, `required|string` sur la description
// sans longueur, `nullable|numeric` sur les salaires sans borne et `date`
// sans calendrier) : bornes de colonnes, plage de salaires, calendrier réel.
//
// INTENTION (contrat d’écran, étape 3 validée) : `enregistrer` = enregistrer
// sans changer de statut (création → brouillon, édition → statut inchangé),
// `publier` = enregistrer + publier. Valeur absente, inconnue ou corrompue →
// `.catch('enregistrer')`, le moins privilégié : jamais de publication par
// accident.

/** Défaut du pays : porté par le blade (`old('pays', 'Cameroun')`), par le
 * contrôleur (`$request->pays ?? 'Cameroun'`) et par la colonne Prisma. */
const PAYS_OFFRE_PAR_DEFAUT = 'Cameroun'

/** Format imposé par `<input type="date">` : AAAA-MM-JJ (3 groupes capturés,
 * réutilisés par le contrôle calendrier ci-dessous). */
const REGEX_DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Vrai si AAAA-MM-JJ désigne un JOUR RÉEL : `2026-02-30` et `2026-13-01`
 * sont rejetés, `2024-02-29` (bissextile) accepté.
 *
 * On construit par composants puis on RELIT les composants : un débordement
 * (30 février → 2 mars, mois 13 → janvier suivant, jour 0 → jour précédent)
 * fait échouer la comparaison. `new Date('2026-02-30')` ne suffit pas :
 * l’interprétation des chaînes ISO n’est pas uniformément normalisée et
 * certains moteurs lisent « 30 » en laissant une date valide.
 */
function estDateCalendaireReelle(valeur: string): boolean {
  const composants = REGEX_DATE_ISO.exec(valeur)
  if (composants === null) {
    return false
  }
  const annee = Number(composants[1])
  const mois = Number(composants[2])
  const jour = Number(composants[3])
  const construite = new Date(0)
  construite.setUTCFullYear(annee, mois - 1, jour)
  return (
    construite.getUTCFullYear() === annee &&
    construite.getUTCMonth() === mois - 1 &&
    construite.getUTCDate() === jour
  )
}

/**
 * Champ salaire (colonnes `Decimal(10,2)` nullable) : champ vide, absent ou
 * nul → `null`, sinon nombre entre 0 et 99 999 999,99 — les bornes EXACTES
 * de la colonne (8 chiffres entiers + 2 décimaux). Le legacy n’imposait
 * aucune borne (`nullable|numeric`) ; au-delà de la colonne, MySQL lèverait
 * une erreur 1264 à l’écriture : l’utilisateur verrait un 500 au lieu d’une
 * erreur de champ. La borne haute appartient donc au schéma, au même titre
 * que celles des autres champs (« bornes de colonnes » du bloc d’en-tête).
 *
 * La conversion passe par `z.unknown()` + `.transform()` plutôt que par
 * `.optional()` : `''` (input number vide) doit devenir `null`, PAS 0 — une
 * coercion aveugle aurait écrit « salaire minimum : 0 » dans l’offre.
 */
function champSalaire(libelle: string) {
  return z
    .unknown()
    // Sortie annotée `unknown` : `.pipe()` de Zod 4 est INVARIANT sur le
    // type d'entrée attendu — un transform dont la sortie se resserre en
    // `{} | null` (unknown moins null/undefined) n'accepterait plus le
    // `ZodCoercedNumber<unknown>` ci-dessous (erreur TS2345). Le tube
    // produit bien `number | null` en sortie finale (type de la cible).
    .transform(
      (valeur): unknown =>
        valeur === undefined || valeur === null || valeur === '' ? null : valeur,
    )
    .pipe(
      z.coerce
        .number({ error: `${libelle} : un nombre est attendu.` })
        .min(0, { error: `${libelle} ne peut pas être négatif.` })
        .max(99_999_999.99, { error: `${libelle} ne peut pas dépasser 99 999 999,99.` })
        .nullable(),
    )
    // `.default(null)` — piège Zod 4.6 : en clé d'objet, `z.unknown()` ne
    // porte aucun `optin`, donc une clé RÉELLEMENT OMISE déclenche une issue
    // synthétique `nonoptional` (« expected nonoptional, received undefined »)
    // même si le transform a bien produit `null` — message interne non
    // localisé, contraire au JSDoc ci-dessus. `.default()` marque la clé
    // optionnelle à l'entrée tout en gardant la sortie `number | null`
    // (le défaut ne se déclenche QUE sur `undefined` : `null`, `''` et
    // `'abc'` continuent d'alimenter le tube normal, erreurs comprises).
    .default(null)
}

/**
 * Message unique de `categorie_id` : option vide du select (« -- Choisir
 * une catégorie -- ») OU identifiant hors catalogue. Les deux cas enseignent
 * la même chose au recruteur (« choisissez une catégorie dans la liste ») :
 * c'est aussi la constante que les actions M6 importent pour le contrôle
 * d'appartenance au catalogue (contrôle `exists:categories,id` legacy,
 * commenté à la clé du schéma ci-dessous).
 */
export const ERREUR_CATEGORIE_INCONNUE =
  'Catégorie requise : choisissez une catégorie dans la liste.'

export const OffreFormSchema = z
  .object({
    /** VarChar(200) — 3 caractères minimum pour ne pas enregistrer « AB ». */
    titre: z
      .string({ error: 'Titre du poste requis.' })
      .transform(texteSansBalises)
      .pipe(
        z
          .string()
          .trim()
          .min(3, { error: 'Le titre du poste doit contenir au moins 3 caractères.' })
          .max(200, { error: 'Le titre du poste ne doit pas dépasser 200 caractères.' }),
      ),

    /** `<select required>` avec option vide « -- Choisir une catégorie -- » :
     * l’option vide vaut `''` → 0 → refusée, tout doit être un id ≥ 1.
     * L’appartenance au catalogue est vérifiée côté action (`exists:categories,id`
     * legacy) : la FK se charge de l’existence, pas Zod. */
    categorie_id: z.coerce
      .number({ error: 'Catégorie : identifiant numérique attendu.' })
      .int({ error: 'Catégorie : identifiant entier attendu.' })
      .min(1, { error: ERREUR_CATEGORIE_INCONNUE }),

    /** LongText — borne à 10 000 caractères (durcissement, la colonne admet
     * davantage) : le legacy n’imposait AUCUNE longueur. */
    description: z
      .string({ error: 'Description du poste requise.' })
      .transform(texteSansBalises)
      .pipe(
        z
          .string()
          .trim()
          .min(1, { error: 'La description du poste est requise.' })
          .max(10_000, { error: 'La description du poste ne doit pas dépasser 10 000 caractères.' }),
      ),

    /** Valeurs legacy du select (identiques à l’enum Prisma) : CDI, CDD,
     * stage, freelance, temps_partiel. Message listant les intitulés affichés
     * du blade (« Stage », « Freelance », « Temps partiel »). */
    type_contrat: z.enum(TYPE_CONTRAT_VALUES, {
      error: 'Type de contrat inconnu : choisissez CDI, CDD, Stage, Freelance ou Temps partiel.',
    }),

    /** Valeurs legacy du select, intitulés affichés du blade (plus longs que
     * la section Libellés M5, qui reste inchangée — elle appartient à M5). */
    niveau_experience: z.enum(NIVEAU_EXPERIENCE_VALUES, {
      error:
        'Niveau d’expérience inconnu : choisissez Sans expérience, Junior (1-2 ans), Intermédiaire (3-5 ans) ou Senior (5+ ans).',
    }),

    /** VarChar(100), requis dans le blade. */
    ville: z
      .string({ error: 'Ville requise.' })
      .transform(texteSansBalises)
      .pipe(
        z
          .string()
          .trim()
          .min(1, { error: 'La ville est requise.' })
          .max(100, { error: 'La ville ne doit pas dépasser 100 caractères.' }),
      ),

    /** VarChar(100) : valeur absente ou chaîne vide → défaut du blade
     * `old('pays', 'Cameroun')` (même défaut que la colonne Prisma). Le champ
     * reste borné à 100 caractères : le défaut ne sert QUE si le champ est
     * vide, il ne contredit jamais la borne. */
    pays: z
      .string({ error: 'Pays invalide.' })
      .transform(texteSansBalises)
      .pipe(
        z
          .string()
          .trim()
          .max(100, { error: 'Le pays ne doit pas dépasser 100 caractères.' })
          .transform((valeur) => (valeur === '' ? PAYS_OFFRE_PAR_DEFAUT : valeur)),
      )
      .default(PAYS_OFFRE_PAR_DEFAUT),

    /**
     * `type="date"` : format AAAA-MM-JJ imposé par le navigateur, plus un
     * attribut `min="{{ date('Y-m-d', '+1 day') }}"` côté CLIENT seulement
     * (create.blade.php) — un POST contourne toujours un attribut HTML.
     * Le schéma vérifie donc le format ET le calendrier réel.
     *
     * AUCUNE comparaison avec aujourd’hui ici (différent de la règle D3) :
     * date ≥ aujourd’hui à Douala est la condition de PUBLICATION, vérifiée
     * lors de la transition de statut côté action serveur. Enregistrer un
     * brouillon avec une date déjà passée reste légitime et ne doit pas être
     * bloqué par la validation du formulaire.
     */
    date_expiration: z
      .string({ error: 'Date d’expiration requise.' })
      .transform(texteSansBalises)
      .pipe(
        z
          .string()
          .trim()
          .regex(REGEX_DATE_ISO, {
            error: 'Date d’expiration invalide : format attendu AAAA-MM-JJ.',
          })
          .refine(estDateCalendaireReelle, {
            error: 'Date d’expiration inexistante : ce jour n’existe pas dans le calendrier.',
          }),
      ),

    /** `type="number"` (FCFA), facultatif dans le blade → `null` si vide. */
    salaire_min: champSalaire('Salaire minimum (FCFA)'),

    /** `type="number"` (FCFA), facultatif dans le blade → `null` si vide. */
    salaire_max: champSalaire('Salaire maximum (FCFA)'),

    /**
     * Case à cocher SANS `value` dans le blade : le navigateur n’émet QUE
     * `'on'` quand elle est cochée, la clé est absente sinon.
     *
     * Choix : transformation explicite sur les valeurs « absentes » plutôt que
     * `z.coerce.boolean()` (aveugle : `Boolean(valeur)` convertirait chaque
     * chaîne, y compris `'false'`/`'0'`, en `true`, et rendrait le sens du
     * champ dépendant d’une conversion implicite non lisible ici).
     *
     * Absent = `undefined` (clé omise), `null` (`formData.get()` sur clé
     * absente) ou `false` explicite ; `''` est aussi false PAR SÉCURITÉ :
     * `formDataString()` — la convention du repo pour lire le FormData —
     * renvoie `''` pour une clé absente, et une case NON cochée ne doit
     * jamais basculer en `true`. Toute autre valeur (dont la `'on'` du
     * navigateur) → `true`.
     */
    salaire_visible: z
      .unknown()
      .transform(
        (valeur) =>
          valeur !== undefined && valeur !== null && valeur !== false && valeur !== '',
      )
      // `.default(false)` — même piège Zod 4.6 que `champSalaire` : case NON
      // cochée = clé OMISE du FormData, refusée sans défaut par une issue
      // `nonoptional` synthétique. Rend vrai le « Absent = `undefined` (clé
      // omise) » du JSDoc ci-dessus, sortie `boolean` inchangée.
      .default(false),

    /**
     * Clé FormData = `competences[]` dans le blade (PHP retire les crochets →
     * `competences`) : cases à cocher `value="{{ $competence->id }}"`, donc
     * des ID du CATALOGUE, jamais du texte libre — le pipeline de nettoyage ne
     * s’applique pas, la colonne pivot attend des entiers.
     *
     * Aucune sélection est autorisée (le blade n’impose rien et affiche même
     * « Aucune compétence disponible ») : clé absente → `[]`, comme le
     * `has('competences')` faux du legacy qui détachait tout.
     * Déduplication : la même case relayée (double envoi) ne compte qu’une fois.
     * Plafond 50 = durcissement d’entrée : le catalogue ne peut pas offrir
     * plus de cases à un humain ; un envoi au-delà est un payload fabriqué.
     * PAS de contrôle d’appartenance au catalogue ici : la FK
     * (offre_competences.competence_id) tranche côté action, qui ignorera les
     * ID inconnus — Zod ne doit pas dupliquer cette vérification.
     */
    competences: z
      .array(
        z.coerce
          .number({ error: 'Compétence : identifiant numérique attendu.' })
          .int({ error: 'Compétence : identifiant entier attendu.' })
          .min(1, { error: 'Compétence : identifiant positif attendu.' }),
        { error: 'Liste de compétences invalide.' },
      )
      .max(50, { error: 'Trop de compétences sélectionnées (maximum 50).' })
      .transform((valeurs) => [...new Set(valeurs)])
      .default([]),

    /** Contrat d’écran M6 : `'enregistrer'` (le moins privilégié) ou
     * `'publier'`. `.catch()` absorbe clé absente, `''`, casse différente ou
     * toute valeur corrompue → jamais de publication par accident. */
    intention: z.enum(['enregistrer', 'publier'], { error: 'Intention inconnue.' }).catch('enregistrer'),
  })
  .superRefine((donnees, contexte) => {
    // Bornes cohérentes : `salaire_min ≤ salaire_max` uniquement quand les DEUX
    // sont renseignés (un minimum seul ou un maximum seul est déjà utile).
    if (
      donnees.salaire_min !== null &&
      donnees.salaire_max !== null &&
      donnees.salaire_min > donnees.salaire_max
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['salaire_min'],
        // `message` et non `error` : sur un issue poussé via addIssue, Zod ne
        // lit que `issue.message` (le paramètre `error` ne vaut que pour les
        // params de schéma, plus haut).
        message:
          'Le Salaire minimum (FCFA) doit être inférieur ou égal au Salaire maximum (FCFA).',
      })
    }
  })

/** Données validées d’un formulaire d’offre (entrées nettoyées, sorties
 * typées : `salaire_*: number | null`, `salaire_visible: boolean`,
 * `competences: number[]`, `intention: 'enregistrer' | 'publier'`). */
export type OffreFormData = z.infer<typeof OffreFormSchema>
