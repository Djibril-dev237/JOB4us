import 'server-only'

import type { Prisma, StatutCandidature, StatutOffre, TypeContrat } from '@prisma/client'

import { statutAffiche } from '@/lib/offres-labels'
import { prisma } from '@/lib/prisma'

// ─── Couche d'accès aux données des CANDIDATURES (M7) ────────────────────────
//
// Deux périmètres STRICTS, jamais mélangés, et un principe unique : le
// contrôle d'appartenance vit DANS le `where` de la requête qui lit —
// jamais une lecture d'abord, un contrôle ensuite.
//
// 1. CÔTÉ CANDIDAT : chaque lecture porte `candidatId` (paramètre fourni
//    par l'appelant authentifié — ce module ne lit JAMAIS `session` ni
//    `auth`) dans LE MÊME `where` que l'id de la candidature. La
//    candidature d'un autre compte produit exactement le même `null`
//    qu'une candidature inexistante : la page convertit ce `null` en 404
//    strict (doctrine M6 — jamais 403, jamais de branche « pas la
//    vôtre », qui révélerait l'existence des lignes d'autrui).
// 2. CÔTÉ RECRUTEUR : la jointure `offre → entreprise → userId` EST dans
//    le `where` de CHAQUE requête (findMany, count, findFirst, groupBy).
//    Elle est donc posée EN MÊME TEMPS que le filtre `offreId` (les deux
//    sont en intersection : un `offreId` étranger ne peut que vider la
//    liste) et que l'id de la candidature (détail). Aucune fonction ne
//    vérifie l'ownership « après coup » : la fenêtre de course (TOCTOU)
//    et les deux chemins d'erreur potentiellement distincts n'existent pas.
//
// Aucune fonction ne renvoie jamais `undefined` ni une erreur pour un
// problème de périmètre : UNE seule forme de « non trouvé », `null`, dont
// la seule suite possible côté page/action est `notFound()` (404 uniforme).
//
// RÈGLE DE DONNÉES (matrice étape 2, §2.5) — matérialisée par les
// `select` explicites ci-dessous (JAMAIS d'`include` du modèle entier) :
//  * côté RECRUTEUR, le candidat n'expose QUE `user.name`, `user.email`
//    et `Candidat.titreProfil` — jamais `resume`, `dateNaissance`, `genre`,
//    `disponibilite`, `avatar`, `competences`, `experiences`, `formations`
//    ni le `cvPath` du PROFIL. La lettre de motivation complète et le
//    booléen `cvSelectionne` ne sortent qu'en DÉTAIL, jamais en liste ;
//    la clé `cvPath` (fichier) ne quitte jamais ce module : seul un
//    booléen dérivé est exposé — l'accès au fichier vit dans une route
//    dédiée, avec son propre contrôle et son journal (AccesFichier).
//  * côté CANDIDAT : sa propre candidature + les données publiques de
//    l'offre (titre, slug, ville, typeContrat, nom de l'entreprise,
//    statut, dateExpiration, deletedAt) — pour afficher l'état de l'offre
//    sans jamais lire un autre compte.
//
// « Retirée » vs « expirée » : `offreRetiree` (dérivé, cf. `estOffreRetiree`
// ci-dessous) ne rend VRAI que la suppression logique et les statuts non
// publiés ; l'expiration reste du ressort de `statutAffiche` importé de
// src/lib/offres-labels.ts (frontière Douala testée là-bas) — jamais
// recopiée ici.
//
// AUCUNE ÉCRITURE dans ce module : création, changement de statut, note et
// retrait vivent dans les server actions. Ce fichier ne fait que LIRE — le
// mock des tests n'expose d'ailleurs que des méthodes de lecture : toute
// écriture y lèverait une TypeError.
// ---------------------------------------------------------------------------

/** Pagination : 15 par page, identique au `paginate(15)` legacy (`Recruteur\CandidatureController`). */
export const CANDIDATURES_PAR_PAGE = 15

/**
 * Longueur de l'aperçu de lettre en liste. Legacy : `Str::limit($lettre, 120)`
 * — `mb_strimwidth(..., 0, 120, '…')` renvoie une chaîne d'au plus 120
 * caractères, points de suspension COMPRIS.
 *
 * src/lib/texte.ts n'expose qu'un retrait de balises (`texteSansBalises`),
 * aucune troncature : la règle est donc locale au DAL, citée ici plutôt que
 * recopiée depuis un helper inexistant.
 */
const LONGUEUR_EXTRAIT_LETRE = 120

// ─── Formes de retour ────────────────────────────────────────────────────────

/** Calque de `ResultatListeOffres` (src/lib/offres-public.ts). */
export interface ResultatListeCandidatures<T> {
  /** Page rendue (jamais vide de sens : `pages >= 1`). */
  items: T[]
  /** Nombre total de lignes correspondant au même `where`. */
  total: number
  /** Page effectivement rendue (ramenée à >= 1). */
  page: number
  /** Nombre de pages (au moins 1, même à total nul). */
  pages: number
}

/** Filtres bruts — validés côté page/action (Zod), jamais ici. */
export interface FiltresCandidatures {
  statut?: StatutCandidature
  page?: number
  offreId?: number
}

// ─── DTO (listes blanches — jamais le modèle complet) ────────────────────────

/**
 * Ligne de la liste du CANDIDAT : sa candidature + les données publiques
 * de l'offre. `offreRetiree` est dérivé (cf. `estOffreRetiree`) pour que
 * la page distingue sans calcul l'offre toujours consultable de celle qui
 * a disparu ; l'expiration, elle, s'affiche via `statutAffiche(offre)`.
 */
export interface CandidatureCandidat {
  id: number
  statut: StatutCandidature
  createdAt: Date
  /** Aperçu de la lettre, 120 caractères max (null si aucune lettre). */
  lettreExtrait: string | null
  offre: {
    id: number
    titre: string
    slug: string | null
    ville: string
    typeContrat: TypeContrat
    statut: StatutOffre
    dateExpiration: Date
    deletedAt: Date | null
    nomEntreprise: string
  }
  offreRetiree: boolean
}

/**
 * Fiche de la candidature VUE PAR LE CANDIDAT : la liste + la lettre de
 * motivation COMPLÈTE (null si absente) + `cvSelectionne` — un booléen
 * dérivé de `Candidature.cvPath`. La clé `cvPath` elle-même ne sort
 * jamais : l'accès au fichier est une route séparée, pas un champ de DTO.
 */
export interface CandidatureCandidatDetail extends CandidatureCandidat {
  lettreMotivation: string | null
  cvSelectionne: boolean
}

/**
 * Ligne de la liste du RECRUTEUR : strictement §2.5 — le candidat se
 * réduit à `nom` (user.name), `email` (user.email) et `titreProfil`, et
 * l'offre à son id + titre (l'écran n'affiche que la carte). Jamais de
 * `noteRecruteur`, jamais de champ de profil, jamais de coordonnées.
 */
export interface CandidatureRecruteur {
  id: number
  statut: StatutCandidature
  createdAt: Date
  lettreExtrait: string | null
  candidat: {
    nom: string
    email: string | null
    titreProfil: string | null
  }
  offre: {
    id: number
    titre: string
  }
}

/**
 * Fiche côté RECRUTEUR : la liste + lettre complète + `cvSelectionne`
 * (booléen dérivé, jamais la clé) + offre étendue aux champs publics
 * (slug pour le lien, ville/typeContrat pour le rappel, `deletedAt` pour
 * signaler une offre retirée, statut/dateExpiration pour dériver
 * `statutAffiche` côté page). Le candidat reste la liste blanche §2.5.
 */
export interface CandidatureRecruteurDetail extends Omit<CandidatureRecruteur, 'offre'> {
  lettreMotivation: string | null
  cvSelectionne: boolean
  offre: {
    id: number
    titre: string
    slug: string | null
    ville: string
    typeContrat: TypeContrat
    statut: StatutOffre
    dateExpiration: Date
    deletedAt: Date | null
  }
}

// ─── Selects (explicites : jamais `include`) ─────────────────────────────────

/**
 * Offre côté CANDIDAT : les données publiques de la fiche M5, pour que la
 * page rappelle le poste sans requête supplémentaire (une seule findMany,
 * aucun N+1). Le nom de l'entreprise monte via `entreprise.nom` puis est
 * aplati en `nomEntreprise` dans le DTO.
 */
const SELECT_OFFRE_CANDIDAT = {
  id: true,
  titre: true,
  slug: true,
  ville: true,
  typeContrat: true,
  statut: true,
  dateExpiration: true,
  deletedAt: true,
  entreprise: { select: { nom: true } },
} satisfies Prisma.OffreSelect

/** Liste du candidat : aucune donnée de compte, ni clé de fichier. */
const SELECT_CANDIDATURE_CANDIDAT = {
  id: true,
  statut: true,
  createdAt: true,
  lettreMotivation: true,
  offre: { select: SELECT_OFFRE_CANDIDAT },
} satisfies Prisma.CandidatureSelect

/**
 * Détail du candidat : la liste + `cvPath` UNIQUEMENT pour dériver le
 * booléen `cvSelectionne` — cette clé n'est jamais reprise dans le DTO
 * (contrat §2.5 : la clé d'objet ne sort pas d'ici).
 */
const SELECT_CANDIDATURE_CANDIDAT_DETAIL = {
  ...SELECT_CANDIDATURE_CANDIDAT,
  cvPath: true,
} satisfies Prisma.CandidatureSelect

/**
 * Liste côté RECRUTEUR : le candidat se limite à `titreProfil` + les deux
 * champs du `User` utiles à l'affichage et au contact (`name`, `email`).
 * Interdits, donc ABSENTS : `phone`, `resume`, `cvPath` (profil),
 * `dateNaissance`, `genre`, `disponibilite`, `avatar`, `competences`,
 * `experiences`, `formations` — aucune requête ne les lit, donc aucun
 * chemin de fuite n'est ouvert.
 */
const SELECT_CANDIDATURE_RECRUTEUR = {
  id: true,
  statut: true,
  createdAt: true,
  lettreMotivation: true,
  candidat: {
    select: {
      titreProfil: true,
      user: { select: { name: true, email: true } },
    },
  },
  offre: { select: { id: true, titre: true } },
} satisfies Prisma.CandidatureSelect

/**
 * Détail côté RECRUTEUR : idem liste, `cvPath` de la CANDIDATURE (jamais
 * celui du profil) pour le booléen `cvSelectionne`, et offre étendue.
 * `noteRecruteur` reste hors select ici : il n'est lu que par l'action de
 * transition, jamais par ce module de lecture.
 */
const SELECT_CANDIDATURE_RECRUTEUR_DETAIL = {
  ...SELECT_CANDIDATURE_RECRUTEUR,
  cvPath: true,
  offre: {
    select: {
      id: true,
      titre: true,
      slug: true,
      ville: true,
      typeContrat: true,
      statut: true,
      dateExpiration: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.CandidatureSelect

// ─── Sources (lignes brutes telles que Prisma les renvoie) ───────────────────

/**
 * Forme exacte renvoyée par `SELECT_OFFRE_CANDIDAT` : le mapper est
 * compilé CONTRE ces types, donc un select amputé d'un champ (ou
 * l'ajout d'un champ non déclaré) casse le typecheck — la liste blanche
 * n'est pas seulement documentée, elle est vérifiée.
 */
interface SourceOffre {
  id: number
  titre: string
  slug: string | null
  ville: string
  typeContrat: TypeContrat
  statut: StatutOffre
  dateExpiration: Date
  deletedAt: Date | null
  entreprise: { nom: string }
}

interface SourceCandidatureCandidat {
  id: number
  statut: StatutCandidature
  createdAt: Date
  lettreMotivation: string | null
  offre: SourceOffre
}

interface SourceCandidatureCandidatDetail extends SourceCandidatureCandidat {
  cvPath: string | null
}

interface SourceCandidatureRecruteur {
  id: number
  statut: StatutCandidature
  createdAt: Date
  lettreMotivation: string | null
  candidat: {
    titreProfil: string | null
    user: { name: string; email: string | null }
  }
  offre: { id: number; titre: string }
}

interface SourceCandidatureRecruteurDetail extends SourceCandidatureRecruteur {
  cvPath: string | null
  offre: {
    id: number
    titre: string
    slug: string | null
    ville: string
    typeContrat: TypeContrat
    statut: StatutOffre
    dateExpiration: Date
    deletedAt: Date | null
  }
}

// ─── Dérivés ─────────────────────────────────────────────────────────────────

/**
 * Aperçu de la lettre pour une liste (120 caractères max, `…` compris) :
 * reprise du `Str::limit($lettre, 120)` du legacy (`Recruteur\
 * CandidatureController`). La lettre COMPLÈTE n'est lue qu'en détail.
 */
function extraitLettre(lettre: string | null): string | null {
  if (lettre === null) return null
  if (lettre.length <= LONGUEUR_EXTRAIT_LETRE) return lettre
  return `${lettre.slice(0, LONGUEUR_EXTRAIT_LETRE - 1)}…`
}

/**
 * L'offre d'une candidature est-elle RETIRÉE pour le candidat ?
 *
 * `statutAffiche` est RÉUTILISÉ (import de src/lib/offres-labels.ts) plutôt
 * que recopié : la dérivation « expirée » (frontière Douala, recalculée à
 * chaque lecture) appartient à ce module-là et n'a qu'une implémentation.
 * Mais « expirée » est ensuite GROUPÉE avec « publiée » : une offre
 * `publiee` dont la date est passée reste consultable — c'est le badge
 * « Expirée » de `statutAffiche`, affiché côté page, qui le signale, pas
 * ce booléen. Retirée = `deletedAt` non nul OU un état non publié
 * (brouillon, clôturée, suspendue).
 */
function estOffreRetiree(offre: SourceOffre, maintenant: Date): boolean {
  if (offre.deletedAt !== null) return true

  const etat = statutAffiche(
    { statut: offre.statut, dateExpiration: offre.dateExpiration },
    maintenant,
  )
  return etat !== 'publiee' && etat !== 'expiree'
}

// ─── Mappers (source → DTO) ──────────────────────────────────────────────────

function versCandidatureCandidat(
  ligne: SourceCandidatureCandidat,
  maintenant: Date,
): CandidatureCandidat {
  return {
    id: ligne.id,
    statut: ligne.statut,
    createdAt: ligne.createdAt,
    lettreExtrait: extraitLettre(ligne.lettreMotivation),
    offre: {
      id: ligne.offre.id,
      titre: ligne.offre.titre,
      slug: ligne.offre.slug,
      ville: ligne.offre.ville,
      typeContrat: ligne.offre.typeContrat,
      statut: ligne.offre.statut,
      dateExpiration: ligne.offre.dateExpiration,
      deletedAt: ligne.offre.deletedAt,
      nomEntreprise: ligne.offre.entreprise.nom,
    },
    offreRetiree: estOffreRetiree(ligne.offre, maintenant),
  }
}

function versCandidatureCandidatDetail(
  ligne: SourceCandidatureCandidatDetail,
  maintenant: Date,
): CandidatureCandidatDetail {
  return {
    ...versCandidatureCandidat(ligne, maintenant),
    lettreMotivation: ligne.lettreMotivation,
    cvSelectionne: ligne.cvPath !== null,
  }
}

function versCandidatureRecruteur(ligne: SourceCandidatureRecruteur): CandidatureRecruteur {
  return {
    id: ligne.id,
    statut: ligne.statut,
    createdAt: ligne.createdAt,
    lettreExtrait: extraitLettre(ligne.lettreMotivation),
    candidat: {
      nom: ligne.candidat.user.name,
      email: ligne.candidat.user.email,
      titreProfil: ligne.candidat.titreProfil,
    },
    offre: { id: ligne.offre.id, titre: ligne.offre.titre },
  }
}

function versCandidatureRecruteurDetail(
  ligne: SourceCandidatureRecruteurDetail,
): CandidatureRecruteurDetail {
  return {
    ...versCandidatureRecruteur(ligne),
    lettreMotivation: ligne.lettreMotivation,
    cvSelectionne: ligne.cvPath !== null,
    offre: {
      id: ligne.offre.id,
      titre: ligne.offre.titre,
      slug: ligne.offre.slug,
      ville: ligne.offre.ville,
      typeContrat: ligne.offre.typeContrat,
      statut: ligne.offre.statut,
      dateExpiration: ligne.offre.dateExpiration,
      deletedAt: ligne.offre.deletedAt,
    },
  }
}

// ─── Pagination (commune aux deux listes) ────────────────────────────────────

/**
 * Page demandée ramenée dans les bornes : défaut 1, strictement entière,
 * `Math.max(1, …)` — page 0, négative ou NaN valent page 1 (donc skip 0).
 * Aucun PLAFONNEMENT à `pages` : une URL partagée périmée renvoie une page
 * vide plutôt que d'être réécrite silencieusement (le compteur `total` dit
 * à la page ce qu'il en est).
 */
function pageCourante(pageDemandee: number | undefined): number {
  const entier = Math.trunc(pageDemandee ?? 1)
  return Number.isFinite(entier) ? Math.max(1, entier) : 1
}

/**
 * `where` de liste : la clause de PÉRIMÈTRE (candidatId, ou la jointure
 * d'appartenance recruteur) est passée par l'appelant et reste intacte ;
 * `statut` n'est ajouté QUE s'il est fourni, `offreId` s'intersectionne
 * toujours avec le périmètre (jamais ne le remplace).
 */
function whereCandidatures(
  perimetre: Prisma.CandidatureWhereInput,
  filtres: FiltresCandidatures,
): Prisma.CandidatureWhereInput {
  const where: Prisma.CandidatureWhereInput = { ...perimetre }
  if (filtres.statut !== undefined) where.statut = filtres.statut
  if (filtres.offreId !== undefined) where.offreId = filtres.offreId
  return where
}

function resultatListe<T>(
  items: T[],
  total: number,
  page: number,
): ResultatListeCandidatures<T> {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / CANDIDATURES_PAR_PAGE)) }
}

// ─── Lectures côté CANDIDAT (toujours scopées par candidatId) ────────────────

/**
 * Liste des candidatures d'un candidat, paginée, avec les données
 * publiques de l'offre.
 *
 * 2 requêtes en parallèle (count + findMany) sur l'index
 * `(candidatId, createdAt)` : `WHERE candidat_id = ? [AND statut = ?]
 * ORDER BY created_at DESC LIMIT 15` se lit depuis l'index, sans filesort.
 * Aucune requête par ligne : l'offre et son entreprise montent dans le
 * même `select` (aucun N+1).
 *
 * `offreRetiree` est false pour une offre publiée même expirée : « expirée »
 * s'affiche via `statutAffiche`, « retirée » encode la disparition réelle.
 */
export async function listerCandidaturesCandidat(
  candidatId: number,
  filtres: FiltresCandidatures = {},
): Promise<ResultatListeCandidatures<CandidatureCandidat>> {
  const where = whereCandidatures({ candidatId }, filtres)
  const page = pageCourante(filtres.page)
  const maintenant = new Date()

  const [total, lignes] = await Promise.all([
    prisma.candidature.count({ where }),
    prisma.candidature.findMany({
      where,
      select: SELECT_CANDIDATURE_CANDIDAT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * CANDIDATURES_PAR_PAGE,
      take: CANDIDATURES_PAR_PAGE,
    }),
  ])

  return resultatListe(
    lignes.map((ligne) => versCandidatureCandidat(ligne, maintenant)),
    total,
    page,
  )
}

/**
 * Fiche d'une candidature vue par SON candidat : existence + propriété
 * dans le MÊME `where` d'une SEULE requête.
 *
 * `null` = 404 strict : la candidature d'un autre compte est
 * indiscernable d'une ligne absente (aucun indice, aucune erreur
 * distincte), conformément à la doctrine M6.
 */
export async function detailCandidatureCandidat(
  candidatId: number,
  candidatureId: number,
): Promise<CandidatureCandidatDetail | null> {
  const ligne = await prisma.candidature.findFirst({
    where: { id: candidatureId, candidatId },
    select: SELECT_CANDIDATURE_CANDIDAT_DETAIL,
  })
  if (ligne === null) return null

  return versCandidatureCandidatDetail(ligne, new Date())
}

// ─── Lectures côté RECRUTEUR (jointure offre→entreprise→userId dans le where) ─

/**
 * Liste globale des candidatures reçues par un compte recruteur.
 *
 * UNE clause de périmètre, répétée dans le `where` du count ET de la
 * findMany : `offre: { entreprise: { userId } }`. C'est cette jointure —
 * et elle seule — qui empêche un compte de lire les candidatures d'un
 * autre ; elle est en INTERSECTION avec `offreId` et `statut`, jamais
 * remplacée par eux. Un `offreId` étranger ne peut donc que produire une
 * liste vide, jamais une fuite.
 *
 * Aucun filtre `deletedAt` : l'historique des candidatures doit survivre
 * à la suppression logique d'une offre (schema.prisma — « l'historique
 * M7 doit survivre »).
 */
export async function listerCandidaturesRecruteur(
  userId: number,
  filtres: FiltresCandidatures = {},
): Promise<ResultatListeCandidatures<CandidatureRecruteur>> {
  const where = whereCandidatures({ offre: { entreprise: { userId } } }, filtres)
  const page = pageCourante(filtres.page)

  const [total, lignes] = await Promise.all([
    prisma.candidature.count({ where }),
    prisma.candidature.findMany({
      where,
      select: SELECT_CANDIDATURE_RECRUTEUR,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * CANDIDATURES_PAR_PAGE,
      take: CANDIDATURES_PAR_PAGE,
    }),
  ])

  return resultatListe(lignes.map(versCandidatureRecruteur), total, page)
}

/**
 * Liste des candidatures d'UNE offre : la possession de l'offre est
 * vérifiée dans le `where` de la requête de possession (`id` + la MÊME
 * jointure `entreprise.userId`), puis la liste répète cette jointure —
 * `offreId` et le périmètre sont donc en intersection dans UNE seule et
 * même requête de lecture, sans jamais se fier à un contrôle antérieur.
 *
 * `null` = offre inexistante OU offre d'un autre compte (les deux sont
 * strictement indiscernables → 404 uniforme). Pas de filtre `deletedAt` :
 * le recruteur doit retrouver les candidatures d'une offre qu'il a
 * supprimée logiquement (l'id sert aussi de lien vers l'historique).
 *
 * 3 requêtes au plus : 1 possession + 1 count + 1 findMany, sans requête
 * par ligne.
 */
export async function listerCandidaturesOffre(
  userId: number,
  offreId: number,
  filtres: FiltresCandidatures = {},
): Promise<ResultatListeCandidatures<CandidatureRecruteur> | null> {
  const offre = await prisma.offre.findFirst({
    where: { id: offreId, entreprise: { userId } },
    select: { id: true },
  })
  if (offre === null) return null

  // La possession est ré-exprimée par la jointure de `listerCandidaturesRecruteur`
  // : même si l'offre changeait de main entre les deux lectures, la seconde
  // resterait scopée (aucune fuite possible, seulement une liste vide).
  return listerCandidaturesRecruteur(userId, { ...filtres, offreId })
}

/**
 * Fiche d'une candidature reçue : existence + appartenance au compte dans
 * LE MÊME `where` (une seule requête, jamais une lecture puis une garde).
 *
 * `null` = 404 strict, identique pour une ligne d'autrui et pour une
 * ligne inexistante. La lettre complète et `cvSelectionne` ne sortent
 * qu'ici ; `cvPath` ne franchit pas la frontière du DTO.
 */
export async function detailCandidatureRecruteur(
  userId: number,
  candidatureId: number,
): Promise<CandidatureRecruteurDetail | null> {
  const ligne = await prisma.candidature.findFirst({
    where: { id: candidatureId, offre: { entreprise: { userId } } },
    select: SELECT_CANDIDATURE_RECRUTEUR_DETAIL,
  })
  if (ligne === null) return null

  return versCandidatureRecruteurDetail(ligne)
}

// ─── Lectures côté ADMIN (globales, réservées aux pages admin) ───────────────
//
// Décision étape 2 : l'admin a une lecture GLOBALE des candidatures (aucune
// clause d'appartenance — il ne possède aucune offre), et ses transitions
// sont tracées par l'audit M7. Ces deux fonctions sont les SEULES du module
// sans périmètre : elles sont donc réservées aux pages/actions qui ont
// VÉRIFIÉ `session.user.role === 'admin'` en amont (contrôle de rôle de
// l'appelant — ce module ne lit pas la session) et sont destinées à être
// appelées depuis des écrans `/admin/*` uniquement. Aucun écran recruteur
// ne doit les importer (la revue V3-J le verrouillera).
//
// Le DTO est EXACTEMENT celui du recruteur (liste blanche §2.5) : le
// moindre privilège s'applique aussi à l'admin — `resume`, `dateNaissance`,
// `phone`, `competences`… restent hors de portée d'une lecture de
// candidature, quel que soit le rôle.

/**
 * Liste globale des candidatures (admin). Mêmes filtres, même pagination,
 * même DTO que le recruteur — sans clause d'appartenance.
 */
export async function listerCandidaturesAdmin(
  filtres: FiltresCandidatures = {},
): Promise<ResultatListeCandidatures<CandidatureRecruteur>> {
  const where = whereCandidatures({}, filtres)
  const page = pageCourante(filtres.page)

  const [total, lignes] = await Promise.all([
    prisma.candidature.count({ where }),
    prisma.candidature.findMany({
      where,
      select: SELECT_CANDIDATURE_RECRUTEUR,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * CANDIDATURES_PAR_PAGE,
      take: CANDIDATURES_PAR_PAGE,
    }),
  ])

  return resultatListe(lignes.map(versCandidatureRecruteur), total, page)
}

/**
 * Fiche d'une candidature (admin, lecture globale) : `null` uniquement si
 * la ligne n'existe pas. Comme partout ailleurs, la page convertit ce
 * `null` en 404.
 */
export async function detailCandidatureAdmin(
  candidatureId: number,
): Promise<CandidatureRecruteurDetail | null> {
  const ligne = await prisma.candidature.findFirst({
    where: { id: candidatureId },
    select: SELECT_CANDIDATURE_RECRUTEUR_DETAIL,
  })
  if (ligne === null) return null

  return versCandidatureRecruteurDetail(ligne)
}

// ─── Compteurs du tableau de bord recruteur ──────────────────────────────────

/**
 * Compteurs par statut pour UN compte : `groupBy` sur la MÊME jointure
 * d'appartenance que les listes (une seule requête, aucune lecture
 * « échantillon puis filtre »).
 *
 * Les 7 statuts de l'ENUM sont TOUJOURS renvoyés (0 par défaut), plus
 * `toutes` = total des lignes du périmètre. `toutes` est la somme des
 * groupes renvoyés — le groupement porte déjà le même where, un count
 * séparé ne dirait rien d'autre.
 */
export async function compteursCandidaturesRecruteur(
  userId: number,
): Promise<Record<StatutCandidature | 'toutes', number>> {
  const groupes = await prisma.candidature.groupBy({
    by: ['statut'],
    where: { offre: { entreprise: { userId } } },
    _count: true,
  })

  const compteurs: Record<StatutCandidature | 'toutes', number> = {
    envoyee: 0,
    consultee: 0,
    preselectionnee: 0,
    entretien: 0,
    acceptee: 0,
    refusee: 0,
    retiree: 0,
    toutes: 0,
  }

  for (const groupe of groupes) {
    compteurs[groupe.statut] = groupe._count
    compteurs.toutes += groupe._count
  }

  return compteurs
}
