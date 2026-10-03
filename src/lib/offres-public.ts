import 'server-only'

import type { NiveauExperience, Prisma, TypeContrat } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { estSlugOffreValide } from '@/lib/slug'

// ─── Couche d'accès aux données PUBLIQUE des offres (M5, task 1) ─────────────
//
// Toute lecture publique d'offre passe par ce module, avec `select`
// explicite (liste blanche de l'étape 2) : jamais d'objet Offre complet
// sérialisé. C'est la SOURCE UNIQUE de la règle « quelle offre est
// visible » (étape 2 validée) : liste, similaires, catégories, compteur
// d'accueil et (via les adaptateurs) le sitemap l'utilisent.
//
// Décisions validées (étape 2) qui se matérialisent ici :
// 1. recruteur actif : `entreprise.user.isActive = true` (fail-closed —
//    le legacy ne vérifiait rien côté compte) ;
// 2. expiration INCLUSIVE : l'offre reste visible toute la journée de son
//    expiration (le legacy la tuait dès 00:00 avec `date_expiration <
//    now()` — le libellé « Expire le J » devenait faux le jour même). La
//    frontière est calculée sur Africa/Douala (UTC+1, fuseau de la cible)
//    pour que dev (UTC+1) et Vercel (UTC) donnent la même réponse. Le
//    filtre est l'INSTANT de minuit Douala (et non une date en clair) :
//    Prisma 6 refuse 'YYYY-MM-DD' sur un champ DateTime (« Expected
//    ISO-8601 DateTime »), et l'instant Douala donne le même résultat
//    que le minuit UTC tout en survivant à une éventuelle conversion de
//    fuseau côté session MySQL (contrôlé sur la base de dev : offre
//    expirant aujourd'hui incluse, offre expirée exclue) ;
// 3. entreprise non vérifiée : reste visible (`isVerified` est un badge,
//    jamais un gate — parité legacy) ;
// 4. les compteurs/catégories de l'accueil sont alignés sur ce même
//    prédicat : une seule vérité, deux lignes au lieu de deux variantes.
//
// Le statut « publié » du legacy est le simple booléen `isActive` :
// brouillon du recruteur et suspension admin partagent la même valeur
// false et reçoivent le même 404 — distinguer les deux demandera un enum
// en M6 (hors périmètre M5).
// ---------------------------------------------------------------------------

/** Fuseau de la cible (Cameroun) : toute date publique s'y réfère. */
const FUSEAU_OFFRES = 'Africa/Douala'

/** Pagination : 10 par page, identique au `paginate(10)` legacy. */
export const OFFRES_PAR_PAGE = 10

/** Nombre maximal d'offres similaires sur une fiche (legacy : `limit(4)`). */
export const OFFRES_SIMILAIRES_MAX = 4

const FORMATEUR_JOUR = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU_OFFRES,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Date du jour au Cameroun, en clair ('YYYY-MM-DD').
 * Sert de base au prédicat de visibilité : le jour est calculé sur le
 * fuseau de la cible, jamais sur celui du serveur applicatif.
 */
export function dateCouranteDouala(now: Date = new Date()): string {
  return FORMATEUR_JOUR.format(now)
}

/**
 * Minuit civil à Douala exprimé comme instant UTC (le Cameroun est en
 * UTC+1 sans DST : décalage constant). Utilisé tel quel dans le filtre
 * `dateExpiration.gte` — forme acceptée par Prisma (contrairement à la
 * date en clair) et vérifiée comme « jour inclus » contre MySQL.
 */
function minuitDouala(civil: string): Date {
  const [annee, mois, jour] = civil.split('-').map(Number)
  return new Date(Date.UTC(annee, mois - 1, jour) - 3_600_000)
}

// ─── Prédicat unique de visibilité (matrice de tests) ────────────────────────

/**
 * OFFRE VISIBLE = publiée (isActive) AND non expirée (jour d'expiration
 * inclus) AND recruteur actif. Toute offre qui échoue — ou qui n'existe
 * pas — produit exactement le même 404, sans exception (aucune fuite
 * d'existence vers propriétaire ou admin sur les routes publiques).
 */
export function offreVisible(now: Date = new Date()): Prisma.OffreWhereInput {
  return {
    isActive: true,
    dateExpiration: { gte: minuitDouala(dateCouranteDouala(now)) },
    entreprise: { user: { isActive: true } },
  }
}

// ─── Listes blanches de champs (étape 2) ─────────────────────────────────────

/** Champs de carte de liste — aperçu strict, aucune donnée privée. */
export const SELECT_OFFRE_LISTE = {
  id: true,
  titre: true,
  // URL publique /offres/<slug> (task 5) : liens des cartes, des similaires
  // et sitemap — le regex d'entrée rejette tout format non généré par
  // src/lib/slug.ts avant toute requête.
  slug: true,
  ville: true,
  pays: true,
  typeContrat: true,
  niveauExperience: true,
  createdAt: true,
  categorie: { select: { id: true, nom: true } },
  // `id` : indispensable pour construire l'URL publique du logo
  // (/api/files/logo?entrepriseId=, option B) — la route re-vérifie elle-
  // même la visibilité, l'id n'est qu'une clé d'appel.
  entreprise: { select: { id: true, nom: true, logo: true } },
} satisfies Prisma.OffreSelect

export type OffreCarte = Prisma.OffreGetPayload<{
  select: typeof SELECT_OFFRE_LISTE
}>

/**
 * Champs de la fiche détaillée — liste blanche complète autorisée.
 * JAMAIS : emailContact, telephone, adresse, siteWeb, description
 * d'entreprise, User, vues, isVerified (décision de l'étape 2).
 */
export const SELECT_OFFRE_DETAIL = {
  ...SELECT_OFFRE_LISTE,
  description: true,
  dateExpiration: true,
  salaireMin: true,
  salaireMax: true,
  salaireVisible: true,
  entreprise: {
    select: {
      id: true,
      nom: true,
      logo: true,
      secteurActivite: true,
      ville: true,
    },
  },
  competences: {
    select: { competence: { select: { nom: true } } },
  },
} satisfies Prisma.OffreSelect

export type OffreDetail = Prisma.OffreGetPayload<{
  select: typeof SELECT_OFFRE_DETAIL
}>

// ─── Filtres (types bruts ; validation Zod côté page, task 3) ────────────────

export interface FiltresOffres {
  q?: string | undefined
  ville?: string | undefined
  categorie?: number | undefined
  typeContrat?: TypeContrat | undefined
  niveau?: NiveauExperience | undefined
  page?: number | undefined
}

export interface ResultatListeOffres {
  offres: OffreCarte[]
  /** Nombre total d'offres correspondantes (affiché en tête de liste). */
  total: number
  /** Page effectivement rendue (ramenée dans les bornes). */
  page: number
  totalPages: number
}

// ─── Lectures ────────────────────────────────────────────────────────────────

/**
 * Liste publique paginée : prédicat unique + filtres optionnels, tri par
 * date de publication décroissante (`latest()` legacy).
 *
 * Filtres copiés un pour un du legacy (`OffrePubliqueController@index`) :
 * q = LIKE %q% sur titre OU description, ville = LIKE %ville%,
 * categorie/typeContrat/niveau = égalité exacte.
 *
 * Performance : 2 requêtes (count + findMany) avec `select` imbriqué —
 * AUCUNE requête par ligne (pas de N+1, vérifiable aux logs Prisma).
 * Le count sert aussi à ramener la page demandée dans les bornes : une
 * URL partagée périmée affiche la dernière page réelle plutôt qu'un
 * vide trompeur « 0 résultat ».
 */
export async function listerOffresPubliques(
  filtres: FiltresOffres,
  now: Date = new Date(),
): Promise<ResultatListeOffres> {
  const conditions: Prisma.OffreWhereInput[] = [offreVisible(now)]

  if (filtres.q) {
    // Sous-chaîne n'importe où, comme le LIKE legacy : `contains` MySQL
    // = LIKE %…% (insensible à la casse via la collation de la base).
    conditions.push({
      OR: [{ titre: { contains: filtres.q } }, { description: { contains: filtres.q } }],
    })
  }
  if (filtres.ville) conditions.push({ ville: { contains: filtres.ville } })
  if (typeof filtres.categorie === 'number') {
    conditions.push({ categorieId: filtres.categorie })
  }
  if (filtres.typeContrat) conditions.push({ typeContrat: filtres.typeContrat })
  if (filtres.niveau) conditions.push({ niveauExperience: filtres.niveau })

  const where: Prisma.OffreWhereInput = { AND: conditions }

  const total = await prisma.offre.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / OFFRES_PAR_PAGE))
  const page = Math.min(Math.max(1, filtres.page ?? 1), totalPages)

  const offres = await prisma.offre.findMany({
    where,
    select: SELECT_OFFRE_LISTE,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * OFFRES_PAR_PAGE,
    take: OFFRES_PAR_PAGE,
  })

  return { offres, total, page, totalPages }
}

/**
 * Fiche publique d'une offre par son slug (task 5) : renvoie null si le
 * slug n'existe pas OU si l'offre échoue au prédicat — les deux cas
 * produisent exactement le même 404 côté page (notFound()), aucune fuite
 * d'existence (brouillon, expirée, recruteur suspendu, slug legacy
 * numérique → identiques à une offre absente).
 *
 * Garde-fou : le regex du slug rejette toute forme que nos règles n'ont
 * jamais générée (ancien /offres/<id>, injection, casse) AVANT toute
 * requête base — un scanner ne coûte aucune requête.
 *
 * 1 requête (findFirst avec prédicat), select liste blanche enrichie
 * (description, dates, salaire, compétences — jamais les coordonnées).
 */
export async function lireOffrePublique(
  slug: string,
  now: Date = new Date(),
): Promise<OffreDetail | null> {
  if (!estSlugOffreValide(slug)) return null

  return prisma.offre.findFirst({
    where: { AND: [{ slug }, offreVisible(now)] },
    select: SELECT_OFFRE_DETAIL,
  })
}

/**
 * Offres similaires d'une fiche : même prédicat, même catégorie, offre
 * courante exclue, 4 maximum (copie de `OffrePubliqueController@show`).
 * Le legacy n'imposait AUCUN ordre (résultat non déterministe) : on impose
 * createdAt desc pour un rendu stable — choix assumé, pas un détail PHP
 * supposé.
 */
export async function listerOffresSimilaires(
  categorieId: number,
  offreCouranteId: number,
  now: Date = new Date(),
): Promise<OffreCarte[]> {
  return prisma.offre.findMany({
    where: {
      AND: [
        offreVisible(now),
        { categorieId },
        { id: { not: offreCouranteId } },
      ],
    },
    select: SELECT_OFFRE_LISTE,
    orderBy: { createdAt: 'desc' },
    take: OFFRES_SIMILAIRES_MAX,
  })
}

/**
 * Catégories du formulaire de filtre : TOUTES les catégories, tri alpha,
 * comme `Categorie::orderBy('nom')->get()` legacy. Une option de filtre
 * vide n'est pas une affirmation de contenu (contrairement aux cartes de
 * l'accueil M2 qui n'affichent que les catégories peuplées) : elle peut
 * légitimement mener à « 0 offre ».
 */
export async function listerCategoriesFiltre(): Promise<
  { id: number; nom: string }[]
> {
  return prisma.categorie.findMany({
    orderBy: { nom: 'asc' },
    select: { id: true, nom: true },
  })
}

/**
 * Porte d'accès des logos (option B validée) : un logo d'entreprise ne
 * devient publiquement serviable que si cette entreprise a au moins une
 * offre visible. Appelé par la route /api/files/logo — la page ne fait
 * que l'afficher, la route est l'autoritaire.
 */
export async function entrepriseAOffreVisible(
  entrepriseId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const total = await prisma.offre.count({
    where: { AND: [offreVisible(now), { entrepriseId }] },
  })
  return total > 0
}
