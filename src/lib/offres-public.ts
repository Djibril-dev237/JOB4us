import 'server-only'

import type { NiveauExperience, Prisma, TypeContrat } from '@prisma/client'

import { dateCouranteDouala, minuitDouala } from '@/lib/douala'
import { prisma } from '@/lib/prisma'
import { estSlugOffreValide } from '@/lib/slug'

// ─── Couche d'accès aux données PUBLIQUE des offres (M5, task 1) ─────────────
//
// Toute lecture publique d'offre passe par ce module, avec `select`
// explicite (liste blanche de l'étape 2) : jamais d'objet Offre complet
// sérialisé. C'est la SOURCE UNIQUE de la règle « quelle offre est
// visible » (étape 2 validée) : liste, similaires, catégories, compteur
// d'accueil et (via les adaptateurs) le sitemap l'utilisent — de même
// que le contrôle 404 pré-streaming du proxy (task 10b).
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
//    expirant aujourd'hui incluse, offre expirée exclue) — helpers extraits
//    en M6/P2 dans src/lib/douala.ts (partagés avec l'affichage de statut) ;
// 3. entreprise non vérifiée : reste visible (`isVerified` est un badge,
//    jamais un gate — parité legacy) ;
// 4. les compteurs/catégories de l'accueil sont alignés sur ce même
//    prédicat : une seule vérité, deux lignes au lieu de deux variantes.
//
// Cycle de vie M6 (étape 2 validée) : le booléen `isActive`, qui
// fusionnait brouillon et suspension, a été remplacé par l'enum
// StatutOffre + la colonne `deletedAt` (suppression logique). Le prédicat
// ci-dessous exige `statut = 'publiee'` ET `deletedAt IS NULL` —
// brouillon, clôturée, suspendue, supprimée reçoivent exactement le même
// 404 qu'une offre inexistante. « Expirée » reste DÉRIVÉE (comparaison de
// date à chaque lecture), jamais stockée : aucun cron, aucune écriture.
// ---------------------------------------------------------------------------

/** Pagination : 10 par page, identique au `paginate(10)` legacy. */
export const OFFRES_PAR_PAGE = 10

/** Nombre maximal d'offres similaires sur une fiche (legacy : `limit(4)`). */
export const OFFRES_SIMILAIRES_MAX = 4

// ─── Prédicat unique de visibilité (matrice de tests) ────────────────────────

/**
 * OFFRE VISIBLE = publiée (statut) AND non supprimée (deletedAt) AND non
 * expirée (jour d'expiration inclus) AND recruteur actif. Toute offre qui
 * échoue — ou qui n'existe pas — produit exactement le même 404, sans
 * exception (aucune fuite d'existence vers propriétaire ou admin sur les
 * routes publiques).
 */
export function offreVisible(now: Date = new Date()): Prisma.OffreWhereInput {
  return {
    statut: 'publiee',
    deletedAt: null,
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
 * Contrôle pré-streaming du proxy (task 10b) : ce slug renvoie-t-il une
 * offre visible ? Même prédicat unique que la page, mais sélectif `id`
 * seulement — jamais de contenu (doc proxy : « keep proxy checks fast,
 * and avoid fetching full content there »).
 *
 * Pourquoi cette fonction existe : en Next 16, `notFound()` appelé par la
 * PAGE répond TOUJOURS 200 — le corps stream démarre avant que la page
 * ait résolu sa requête base (doc not-found.js : « 200 for streamed
 * responses, 404 for non-streamed »), que le squelette loading.tsx soit
 * présent ou non et que notFound() soit synchrone (les deux variantes
 * mesurées → 200). Seul le ROUTING sur une URL non appariée pose un 404
 * strict ; le proxy s'exécute avant tout rendu (étape 3 de l'ordre
 * d'exécution Next), donc c'est lui qui doit déclencher ce routing via
 * un rewrite — prescription littérale de loading.md §Status codes :
 * « run this check in proxy to rewrite missing slugs to a not-found
 * route ».
 *
 * Le regex d'entrée est repris ici (et non seulement côté page) : une
 * URL legacy /offres/42 ou injectée ne coûte AUCUNE requête base.
 * Coût : 1 requête indexée (slug unique) par contrôle.
 */
export async function slugOffreVisible(
  slug: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!estSlugOffreValide(slug)) return false

  const offre = await prisma.offre.findFirst({
    where: { AND: [{ slug }, offreVisible(now)] },
    select: { id: true },
  })
  return offre !== null
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
 * Sitemap (task 6) : slugs des offres visibles — le MÊME prédicat unique
 * que la liste et les fiches. Le sitemap du legacy n'existe pas (vérifié :
 * aucune route sitemap/robots côté PHP) ; les critères M5 l'exigent
 * (« 404 … ET sitemap »), donc seules les offres réellement consultables
 * y ont une URL : brouillon, expirée ou recruteur suspendu n'y apparaissent
 * jamais. Sélectif : slug + updatedAt uniquement — aucune donnée
 * affichable ni personnelle ne transite par le sitemap.
 *
 * Pas de pagination : le protocole sitemap autorise 50 000 URL/message et
 * le volume d'offres publiées reste très loin en dessous. `slug: not null`
 * exclut les lignes sans slug de la base (colonne nullable héritée de la
 * migration legacy — le backfill de la task 4 remplit pourtant tout), et
 * le prédicat TS est indispensable : Prisma ne rétrécit PAS le type via
 * ce filtre, sans lui le strict faiblirait sur `string | null`
 * (sinon : /offres/null dans le sitemap).
 */
export async function slugsOffresVisibles(
  now: Date = new Date(),
): Promise<Array<{ slug: string; updatedAt: Date }>> {
  const offres = await prisma.offre.findMany({
    where: { AND: [offreVisible(now), { slug: { not: null } }] },
    select: { slug: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return offres.filter(
    (offre): offre is { slug: string; updatedAt: Date } => offre.slug !== null,
  )
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
