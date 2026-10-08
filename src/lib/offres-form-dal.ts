import 'server-only'

import type { OffreDetail } from '@/lib/offres-public'
import { prisma } from '@/lib/prisma'

// ─── Chargeurs du formulaire d'offre (M6, Vague 2 — agent 2C) ────────────────
//
// Séparation volontaire avec src/lib/offres-dal.ts : ce module ne lit QUE
// ce que le FORMULAIRE doit afficher (catégories, compétences, entreprise de
// la fiche), jamais l'ownership ni une offre à gérer — il n'embarque donc
// aucun prédicat 404 et peut être appelé par les deux pages (créer/éditer)
// sans duplication de requête.
//
// Une SEULE requête par fonction, `select` minimal (liste blanche) : jamais
// de requête par ligne côté rendu (pas de N+1). L'ordre reprend le
// contrôleur legacy (`OffreController@create/@edit` : `orderBy('nom')` sur
// les deux listes) — c'est l'ordre dans lequel le blade boucle, donc celui
// que l'utilisateur a toujours connu.
// ---------------------------------------------------------------------------

/** Entreprise telle que la fiche (et l'aperçu) l'affiche : select identique à
 *  `SELECT_OFFRE_DETAIL.entreprise` — pas de coordonnées, pas de description
 *  (absente de la fiche publique : elle n'est donc pas lue ici non plus). */
export type EntrepriseFiche = OffreDetail['entreprise']

/**
 * Catégories du select `categorie_id` (legacy : `Categorie::orderBy('nom')`).
 * 1 requête.
 */
export async function listerCategories(): Promise<{ id: number; nom: string }[]> {
  return prisma.categorie.findMany({
    select: { id: true, nom: true },
    orderBy: { nom: 'asc' },
  })
}

/**
 * Catalogue des compétences pour les cases `competences[]` (legacy :
 * `Competence::orderBy('nom')`). 1 requête — le formulaire n'a besoin QUE
 * des id/nom : les IDs cochés sont ensuite filtrés par l'action contre ce
 * même catalogue.
 */
export async function listerCompetencesCatalogue(): Promise<
  { id: number; nom: string }[]
> {
  return prisma.competence.findMany({
    select: { id: true, nom: true },
    orderBy: { nom: 'asc' },
  })
}

/**
 * Entreprise complète du compte pour l'en-tête de l'aperçu (initiales ou
 * logo, nom, secteur, ville) : `findUnique` sur `userId` (unique en base →
 * au plus une ligne). 1 requête.
 *
 * `null` = compte sans entreprise : les pages transforment ce cas en 404
 * (même traitement qu'une offre introuvable, aucun message distinct).
 */
export async function entrepriseCompleteDuCompte(
  userId: number,
): Promise<EntrepriseFiche | null> {
  return prisma.entreprise.findUnique({
    where: { userId },
    select: {
      id: true,
      nom: true,
      logo: true,
      secteurActivite: true,
      ville: true,
    },
  })
}
