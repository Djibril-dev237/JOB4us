import 'server-only'

import { dateCouranteDouala, minuitDouala } from '@/lib/douala'
import { prisma } from '@/lib/prisma'

// ─── Statistiques réelles de l'administration (M10) ─────────────────────────
// Chaque valeur est le résultat direct d'une requête Prisma bornée. Aucun
// cumul historique, aucun compteur décoratif : les fenêtres sont explicites
// (30 jours glissants) et la frontière d'expiration des offres est celle de
// Douala, comme le prédicat public M5.
// ---------------------------------------------------------------------------

export const FENETRE_STATISTIQUES_JOURS = 30

export interface StatistiquesAdmin {
  offresActives: number
  candidatures30Jours: number
  comptes30Jours: number
  signalementsOuverts: number
  signalementPlusAncienJours: number | null
  delaiMoyenTraitementHeures: number | null
  comptesSuspendus: number
  offresSuspendues: number
}

export async function lireStatistiquesAdmin(
  maintenant: Date = new Date(),
): Promise<StatistiquesAdmin> {
  const debutFenetre = new Date(
    maintenant.getTime() - FENETRE_STATISTIQUES_JOURS * 24 * 60 * 60 * 1000,
  )
  const frontiereExpiration = minuitDouala(dateCouranteDouala(maintenant))

  const [
    offresActives,
    candidatures30Jours,
    comptes30Jours,
    signalementsOuverts,
    plusAncienOuvert,
    signalementsTraites,
    comptesSuspendus,
    offresSuspendues,
  ] = await prisma.$transaction([
    prisma.offre.count({
      where: {
        statut: 'publiee',
        deletedAt: null,
        dateExpiration: { gte: frontiereExpiration },
      },
    }),
    prisma.candidature.count({ where: { createdAt: { gte: debutFenetre } } }),
    prisma.user.count({
      where: { createdAt: { gte: debutFenetre }, anonymizedAt: null },
    }),
    prisma.signalement.count({ where: { statut: 'ouvert' } }),
    prisma.signalement.findFirst({
      where: { statut: 'ouvert' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.signalement.findMany({
      where: { statut: 'traite', traiteLe: { gte: debutFenetre } },
      select: { createdAt: true, traiteLe: true },
    }),
    prisma.user.count({ where: { isActive: false, role: { not: 'admin' } } }),
    prisma.offre.count({ where: { statut: 'suspendue', deletedAt: null } }),
  ])

  const durees = signalementsTraites
    .map((ligne) =>
      ligne.traiteLe === null
        ? null
        : (ligne.traiteLe.getTime() - ligne.createdAt.getTime()) / 3_600_000,
    )
    .filter((duree): duree is number => duree !== null && duree >= 0)
  const delaiMoyenTraitementHeures =
    durees.length === 0
      ? null
      : Math.round((durees.reduce((total, duree) => total + duree, 0) / durees.length) * 10) /
        10

  const signalementPlusAncienJours =
    plusAncienOuvert === null
      ? null
      : Math.max(
          0,
          Math.floor(
            (maintenant.getTime() - plusAncienOuvert.createdAt.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )

  return {
    offresActives,
    candidatures30Jours,
    comptes30Jours,
    signalementsOuverts,
    signalementPlusAncienJours,
    delaiMoyenTraitementHeures,
    comptesSuspendus,
    offresSuspendues,
  }
}
