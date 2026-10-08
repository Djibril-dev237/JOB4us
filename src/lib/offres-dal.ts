import 'server-only'

import type { Prisma } from '@prisma/client'

import { dateCouranteDouala, minuitDouala } from '@/lib/douala'
import type { ValeurFiltreStatut } from '@/lib/offres-labels'
import { prisma } from '@/lib/prisma'

// ─── Couche d'accès aux données de GESTION des offres (M6, Vague 1) ──────────
//
// Contrat central (étape 2 validée) : toute offre ÉTRANGÈRE au compte — ou
// inexistante, ou supprimée — doit produire EXACTEMENT le même résultat
// qu'une offre inexistante. Ici, ce résultat est `null` : l'action serveur
// (Vague 2) enchaîne sur notFound() → 404 uniforme. JAMAIS de 403, jamais de
// message ou de code distinct : distinguer « pas la vôtre » de « n'existe
// pas » revient à révéler l'existence des offres d'autrui (énumération
// /offres/1, 2, 3…). Un 403 annoncerait d'ailleurs que l'offre existe bien.
//
// Pourquoi UNE SEULE requête par lecture : `id` (existence), `entrepriseId`
// (ownership) et `deletedAt` (suppression logique) sont portés par le MÊME
// `where` — jamais une lecture puis une seconde vérification, qui laisserait
// une fenêtre de course entre les deux (TOCTOU) et, surtout, exposerait deux
// chemins d'erreur potentiellement distincts. Un seul `findFirst`, un seul
// verdict : `null` dans TOUS les cas non trouvés.
//
// « Expirée » n'est PAS filtrée ici, contrairement au public : une offre
// publiée dont la date est dépassée reste gérable (on doit pouvoir la
// clôturer, la relire, la dupliquer). « Expirée » reste DÉRIVÉE à chaque
// lecture (aucun cron, aucun statut stocké) — seul `statut` + `deletedAt`
// font foi dans les transitions.
//
// Statut, ownership et `deletedAt` ne sont JAMAIS modifiables par le
// formulaire (liste blanche d'écriture côté agent 1A) : les listes
// blanches ci-dessous SERVENT ces champs à la lecture (compare-and-set des
// transitions, garde d'ownership) mais ne les autorisent jamais en entrée.
// Ce module alimente les actions serveur de la Vague 2, le dashboard
// /recruteur/offres (chargeur de liste) et la route /admin/offres —
// jamais le client.
// ---------------------------------------------------------------------------

// ─── Entreprise du compte ────────────────────────────────────────────────────

/**
 * Id de l'entreprise rattachée au compte, sinon `null` (aucune entreprise).
 *
 * Une SEULE requête, `select` minimal (`id` seul) : c'est la clé d'ownership
 * que les actions de la Vague 2 passeront aux lecteurs ci-dessous. L'unicité
 * est réelle en base (`Entreprise.userId` est `@unique`, relation 1-1 côté
 * `User.entreprise`), donc `findUnique` sur `userId` ne peut renvoyer au
 * plus une ligne — pas de « et si un compte avait deux entreprises ? ».
 *
 * `null` = compte sans entreprise (jamais d'erreur) : l'appelant décide —
 * la plupart du temps en redirigeant vers la création de l'entreprise, ou
 * en produisant le même 404 qu'une offre inexistante.
 */
export async function entrepriseDuCompte(userId: number): Promise<number | null> {
  const entreprise = await prisma.entreprise.findUnique({
    where: { userId },
    select: { id: true },
  })

  return entreprise?.id ?? null
}

// ─── Listes blanches de champs ───────────────────────────────────────────────

/**
 * Champs nécessaires aux TRANSITIONS de statut et aux actions serveur
 * (publier, clôturer, suspendre, réactiver, supprimer) : c'est tout ce
 * dont une action a besoin pour décider et pour afficher la confirmation.
 *
 * JAMAIS : coordonnées (emailContact, telephone, adresse, siteWeb), `vues`,
 * `description`, ni aucun `User` — le compte du recruteur reste privé. Pas
 * non plus de relation `entreprise` : le seul champ utile est la clé
 * `entrepriseId`, à comparer à celle du compte dans le MÊME where.
 *
 * `deletedAt` est lu (et non écrit) pour que l'appelant puisse afficher un
 * libellé cohérent ; la lecture le filtre déjà à `null`.
 */
export const SELECT_OFFRE_GESTION = {
  id: true,
  titre: true,
  slug: true,
  statut: true,
  dateExpiration: true,
  deletedAt: true,
  entrepriseId: true,
  updatedAt: true,
} satisfies Prisma.OffreSelect

export type OffreGestion = Prisma.OffreGetPayload<{
  select: typeof SELECT_OFFRE_GESTION
}>

/**
 * Champs de formulaire complets : pré-remplissage d'une édition (T3) ET
 * source d'une duplication (T6, qui recrée une offre à partir d'une
 * existante). C'est la liste blanche des champs ACCEPTÉS par le formulaire ;
 * `statut` et `entrepriseId` sont inclus pour être LU-S et JAMAIS reçus de
 * l'entrée (compare-and-set des transitions + garde d'ownership côté action).
 *
 * Compétences via la relation `OffreCompetence` : `id` + `nom` — l'id
 * alimente les cases cochées du pré-remplissage d'édition ET la re-création
 * du pivot lors d'une duplication (T6 : recréer les lignes `competenceId`
 * sans requête de plus), le nom l'affichage. Une seule jointure — jamais
 * une requête par compétence (N+1).
 *
 * JAMAIS ici : coordonnées d'entreprise, `User`, `vues`, `candidatures`.
 * `deletedAt` est absent du pré-remplissage : la lecture l'exige déjà à
 * `null`, l'afficher dans un formulaire n'aurait aucun sens.
 */
export const SELECT_OFFRE_MODIFICATION = {
  titre: true,
  description: true,
  typeContrat: true,
  niveauExperience: true,
  ville: true,
  pays: true,
  salaireMin: true,
  salaireMax: true,
  salaireVisible: true,
  dateExpiration: true,
  categorieId: true,
  slug: true,
  statut: true,
  entrepriseId: true,
  competences: {
    select: { competence: { select: { id: true, nom: true } } },
  },
} satisfies Prisma.OffreSelect

export type OffreModification = Prisma.OffreGetPayload<{
  select: typeof SELECT_OFFRE_MODIFICATION
}>

// ─── Lectures (ownership dans la même requête) ──────────────────────────────

/**
 * Offre à gérer PAR LE RECRUTEUR : existence + ownership + non-supprimée
 * dans LA MÊME `findFirst`.
 *
 * `null` dans TOUS les cas non trouvés — offre inexistante, offre d'un
 * autre compte, offre supprimée — de façon strictement indiscernable : la
 * seule suite possible côté appelant est `notFound()` (404 uniforme).
 * Jamais de 403, jamais de branche « offre d'autrui ».
 *
 * 1 requête indexée (PK `id`, puis filtre `entreprise_id` sur la ligne).
 */
export async function lireOffreGestion(
  offreId: number,
  entrepriseId: number,
): Promise<OffreGestion | null> {
  return prisma.offre.findFirst({
    where: { id: offreId, entrepriseId, deletedAt: null },
    select: SELECT_OFFRE_GESTION,
  })
}

/**
 * Offre à ÉDITER ou à DUPLIQUER par le recruteur : même `where` strict à
 * trois clauses que `lireOffreGestion` (même non-distinction des 404), mais
 * avec la liste blanche de formulaire + compétences.
 *
 * La clé `entrepriseId` est nécessaire ici aussi : le formulaire retomberait
 * sinon sur une offre étrangère si l'appelant se trompait d'id — et, pire,
 * la duplication recréerait une offre volée. Le `select` porte aussi
 * `entrepriseId` pour que l'action de ré-écriture reparte de la bonne valeur.
 */
export async function lireOffreModifiable(
  offreId: number,
  entrepriseId: number,
): Promise<OffreModification | null> {
  return prisma.offre.findFirst({
    where: { id: offreId, entrepriseId, deletedAt: null },
    select: SELECT_OFFRE_MODIFICATION,
  })
}

/**
 * Offre à lire par l'ADMINISTRATEUR (surface minimale D5, /admin/offres) :
 * le même select que la modification, mais SANS filtre `entrepriseId` —
 * l'admin voit toutes les offres vivantes ; le recruteur, seulement les
 * siennes. `deletedAt: null` reste exigé : une offre supprimée logiquement
 * est hors de portée de TOUT le monde, admin compris (et doit produire le
 * même 404 qu'une offre absente, sans distinction).
 *
 * Pas de contrôle de rôle ici : c'est à l'appelant (verifyRole('admin')) de
 * poser le garde — ce module ne décide que de la portée des données.
 */
export async function lireOffrePourAdmin(offreId: number): Promise<OffreModification | null> {
  return prisma.offre.findFirst({
    where: { id: offreId, deletedAt: null },
    select: SELECT_OFFRE_MODIFICATION,
  })
}

// ─── Quota de publication (D4) ──────────────────────────────────────────────

/**
 * Nombre d'offres ACTUELLEMENT publiées d'une entreprise : quota de
 * publication (plafond de 20 offres simultanément publiées), contrôlé AVANT
 * l'écriture du statut côté action — compare-and-set, pas de cron.
 *
 * Point crucial : les offres publiées mais DÉJÀ EXPIRÉES restent COMPTÉES.
 * Aucun job ne bascule leur statut (« expirée » n'est pas un statut stocké,
 * c'est une comparaison de date dérivée à chaque lecture), donc seul le
 * compteur `statut = 'publiee'` fait foi. Une entreprise dépassant le
 * quota parce que ses offres ont vieilli doit CLÔTURER (ou suspendre) ses
 * offres : cette écriture libère réellement la place. Si l'on excluait les
 * expirées du count, le quota serait contournable sans aucune écriture.
 *
 * 1 requête `count` sur l'index `offres_entreprise_id_fkey`.
 */
export async function compterOffresPubliees(entrepriseId: number): Promise<number> {
  return prisma.offre.count({
    where: { entrepriseId, statut: 'publiee', deletedAt: null },
  })
}

// ─── Liste du dashboard de gestion (D8/D9) ───────────────────────────────────

/**
 * Champs affichés par une carte du dashboard (une seule ligne par offre) :
 * identité, statut dérivable, libellés d'affichage et date d'expiration.
 *
 * Volontairement très étroit : ni `description` (LongText), ni
 * coordonnées de l'entreprise, ni `slug`, ni `vues`, ni relation — la liste
 * n'affiche que ce que la carte M6 restitue, et une seule findMany suffit.
 * `slug` est absent car le dashboard n'a AUCUN lien public (le lien se fait
 * en /recruteur/offres/<id>/editer, piloté par `id`).
 */
export const SELECT_OFFRE_LISTE = {
  id: true,
  titre: true,
  statut: true,
  dateExpiration: true,
  ville: true,
  typeContrat: true,
  niveauExperience: true,
} satisfies Prisma.OffreSelect

export type OffreListe = Prisma.OffreGetPayload<{ select: typeof SELECT_OFFRE_LISTE }>

/**
 * Offres d'une entreprise à afficher sur le dashboard, pour UN filtre.
 *
 * Une SEULE `findMany` (aucune requête par ligne, aucun N+1) : le where
 * porte toujours `entrepriseId` + `deletedAt: null` — un compte ne voit
 * que ses offres vivantes, jamais celles d'autrui ni les supprimées.
 *
 * Les 6 valeurs de `ValeurFiltreStatut` sont EXCLUSIVES entre elles, comme
 * dans le prédicat M5 : « publiée » = statut `publiee` ET non échue à
 * Douala, « expirée » = même statut mais échue (jamais les deux), et les
 * trois autres ne filtrent que `statut`. Les bornes viennent de la
 * frontière testée `@/lib/douala` (minuit civil Africa/Douala) — aucun
 * `new Date()` local pour la comparaison : dev UTC+1 et Vercel UTC
 * doivent produire la même liste.
 *
 * Tri repris du legacy (`OffreController::index` → `latest()`) :
 * création la plus récente d'abord. Pas de pagination en M6 (décision
 * documentée : volume borné par compte — D4 pour les publiées, D6 pour le
 * rythme de création).
 */
export async function listerOffresGestion(
  entrepriseId: number,
  filtre: ValeurFiltreStatut,
): Promise<OffreListe[]> {
  const now = new Date()
  const limiteJour = minuitDouala(dateCouranteDouala(now))
  const where: Prisma.OffreWhereInput = { entrepriseId, deletedAt: null }

  switch (filtre) {
    case '':
      // « Toutes » : aucune clause de statut — les 4 statuts stockés et
      // les offres publiées échues sortent ensemble (le badge dérive).
      break
    case 'publiee':
      where.statut = 'publiee'
      where.dateExpiration = { gte: limiteJour }
      break
    case 'expiree':
      where.statut = 'publiee'
      where.dateExpiration = { lt: limiteJour }
      break
    default:
      // brouillon | cloturee | suspendue : statut seul, sans clause de
      // date (une clôturée passée reste clôturée, cf. statutAffiche).
      where.statut = filtre
  }

  return prisma.offre.findMany({
    where,
    select: SELECT_OFFRE_LISTE,
    orderBy: { createdAt: 'desc' },
  })
}
