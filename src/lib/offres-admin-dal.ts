import 'server-only'

import type { Prisma, StatutOffre } from '@prisma/client'

import { dateCouranteDouala, minuitDouala } from '@/lib/douala'
import { prisma } from '@/lib/prisma'

// ─── Accès aux données de l'espace admin minimal des offres (M6, D5) ──────────
//
// Surface D5 validée : l'admin voit TOUTES les offres vivantes, tous
// recruteurs confondus — donc AUCUN filtre `entrepriseId` ici, à la
// différence de src/lib/offres-dal.ts où cette clause EST l'ownership.
// `deletedAt: null` reste exigé partout : une offre supprimée logiquement
// est hors de portée de tout le monde, admin compris, et doit disparaître
// des listes comme des compteurs (même 404 qu'une offre absente côté
// actions, doctrine M6).
//
// Pourquoi UNE seule `findMany` pour la liste : la page admin affiche
// l'intégralité des lignes ; deux jointures (entreprise, catégorie) par
// ligne seraient un N+1 garanti. Les deux relations entrent dans le MÊME
// `select`, avec le seul champ consommé par l'écran : le nom.
//
// Décision de périmètre D5 (signalée au rapport) : le legacy offrait la
// recherche `q`, les filtres catégorie/statut ET la pagination (15/page) —
// rien de tout cela n'est porté ici, la liste est rendue en une passe.
// ---------------------------------------------------------------------------

/**
 * Ligne de la liste admin : uniquement ce que l'écran affiche.
 *
 * `entreprise` / `categorie` sont réduits au NOM (jamais l'id, le logo ni
 * le `User` derrière — pas de donnée privée dans le rendu) et typés
 * `| null` : les replis du blade (`?? 'E'`, `?? 'Entreprise'`,
 * `?? 'Sans catégorie'`) doivent rester des branches VIVANTES du rendu,
 * pas du code mort. Les relations sont obligatoires dans le schéma
 * actuel ; le DTO décrit les besoins de l'écran, pas la cardinalité du
 * join, et tolère donc l'absence d'une relation sans changer d'interface.
 */
export interface OffreAdminLigne {
  id: number
  titre: string
  statut: StatutOffre
  dateExpiration: Date
  ville: string
  createdAt: Date
  entreprise: { nom: string } | null
  categorie: { nom: string } | null
}

/** Liste blanche de la liste admin : jamais de coordonnées ni de `vues`. */
export const SELECT_OFFRE_ADMIN = {
  id: true,
  titre: true,
  statut: true,
  dateExpiration: true,
  ville: true,
  createdAt: true,
  entreprise: { select: { nom: true } },
  categorie: { select: { nom: true } },
} satisfies Prisma.OffreSelect

/**
 * Toutes les offres non supprimées, dans l'ordre du legacy
 * (`OffreAdminController@index` → `latest()` = `created_at` DESC) : la
 * liste admin montre les offres les plus récemment créées en premier.
 *
 * 1 requête pour toute la page, jointures incluses — verrouillé par le
 * test « UNE findMany ».
 */
export async function listerOffresPourAdmin(): Promise<OffreAdminLigne[]> {
  return prisma.offre.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: SELECT_OFFRE_ADMIN,
  })
}

/** Compteurs des 3 cartes d'en-tête de la page admin. */
export interface ComptesOffresAdmin {
  /** Offres vivantes, tous statuts confondus. */
  total: number
  /** Offres `publiee` — SANS clause de date (le statut fait foi). */
  publiees: number
  /** Publiées dont la date d'expiration est déjà passée à Douala. */
  expirees: number
}

/**
 * Les 3 agrégats des cartes de stats, dans UNE seule unité de lecture
 * (`$transaction` batch) : les chiffres doivent décrire la même image de
 * la base — trois lectures indépendantes laisseraient un instant où
 * `total < publiees` (navetteur entre deux requêtes).
 *
 * Bornes :
 * - `total` : `deletedAt: null` seul, tous statuts (l'écran admin ne
 *   filtre rien) ;
 * - `publiees` : `statut: 'publiee'` SANS clause de date, à dessein —
 *   contrairement aux « Actives » legacy (`is_active && date >= now`),
 *   une publiée EXPIRÉE reste comptée car aucun cron ne bascule son
 *   statut (T11 : dérivation seule) ;
 * - `expirees` : publiées dont la date est échue, bornée par
 *   `minuitDouala(dateCouranteDouala())` — la MÊME frontière inclusive
 *   que `estExpiree()` / `statutAffiche()`, calculée sur le fuseau de la
 *   cible et jamais sur `new Date()` local (dev UTC+1, Vercel UTC).
 */
export async function compterOffresPourAdmin(): Promise<ComptesOffresAdmin> {
  const [total, publiees, expirees] = await prisma.$transaction([
    prisma.offre.count({ where: { deletedAt: null } }),
    prisma.offre.count({ where: { statut: 'publiee', deletedAt: null } }),
    prisma.offre.count({
      where: {
        statut: 'publiee',
        deletedAt: null,
        dateExpiration: { lt: minuitDouala(dateCouranteDouala()) },
      },
    }),
  ])

  return { total, publiees, expirees }
}
