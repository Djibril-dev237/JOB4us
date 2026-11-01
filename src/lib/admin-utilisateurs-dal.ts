import 'server-only'

import type { Prisma, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'

// ─── Couche de données de la gestion des utilisateurs (M10) ─────────────────
// Aucune donnée sensible inutile : ni mot de passe, ni secret TOTP, ni chemin
// de CV. Les comptes anonymisés restent visibles en lecture mais ne peuvent
// plus être modifiés par les actions.
// ---------------------------------------------------------------------------

export const UTILISATEURS_PAR_PAGE = 20

export interface FiltresUtilisateursAdmin {
  q?: string
  role?: Role
  statut?: 'actif' | 'suspendu'
  page?: number
  taille?: number
}

export interface LigneUtilisateurAdmin {
  id: number
  name: string
  email: string | null
  role: Role
  isActive: boolean
  anonymizedAt: Date | null
  createdAt: Date
}

export interface ResultatUtilisateursAdmin {
  lignes: LigneUtilisateurAdmin[]
  total: number
  page: number
  taille: number
  pages: number
}

export interface UtilisateurAdminDetail extends LigneUtilisateurAdmin {
  phone: string | null
  ville: string | null
  pays: string
  candidat: {
    id: number
    titreProfil: string | null
    candidatures: number
  } | null
  entreprise: {
    id: number
    nom: string
    ville: string | null
    offres: number
  } | null
}

const SELECT_UTILISATEUR_ADMIN = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  anonymizedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect

function pageBornee(page: number | undefined): number {
  return Number.isFinite(page) ? Math.max(1, Math.trunc(page as number)) : 1
}

function tailleBornee(taille: number | undefined): number {
  return Number.isFinite(taille)
    ? Math.min(100, Math.max(1, Math.trunc(taille as number)))
    : UTILISATEURS_PAR_PAGE
}

/** Construit le WHERE unique de la liste ET du comptage (même périmètre). */
export function clauseUtilisateurs(
  filtres: FiltresUtilisateursAdmin,
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {}
  const q = filtres.q?.trim()
  if (q !== undefined && q !== '') {
    where.OR = [
      { name: { contains: q } },
      { email: { contains: q } },
    ]
  }
  if (filtres.role !== undefined) where.role = filtres.role
  if (filtres.statut === 'actif') where.isActive = true
  if (filtres.statut === 'suspendu') where.isActive = false
  return where
}

export async function listerUtilisateursAdmin(
  filtres: FiltresUtilisateursAdmin = {},
): Promise<ResultatUtilisateursAdmin> {
  const page = pageBornee(filtres.page)
  const taille = tailleBornee(filtres.taille)
  const where = clauseUtilisateurs(filtres)

  const [total, lignes] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * taille,
      take: taille,
      select: SELECT_UTILISATEUR_ADMIN,
    }),
  ])

  return {
    lignes,
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  }
}

export async function lireUtilisateurAdmin(
  userId: number,
): Promise<UtilisateurAdminDetail | null> {
  const utilisateur = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...SELECT_UTILISATEUR_ADMIN,
      phone: true,
      ville: true,
      pays: true,
      candidat: {
        select: {
          id: true,
          titreProfil: true,
          _count: { select: { candidatures: true } },
        },
      },
      entreprise: {
        select: {
          id: true,
          nom: true,
          ville: true,
          _count: { select: { offres: true } },
        },
      },
    },
  })
  if (utilisateur === null) return null

  return {
    id: utilisateur.id,
    name: utilisateur.name,
    email: utilisateur.email,
    role: utilisateur.role,
    isActive: utilisateur.isActive,
    anonymizedAt: utilisateur.anonymizedAt,
    createdAt: utilisateur.createdAt,
    phone: utilisateur.phone,
    ville: utilisateur.ville,
    pays: utilisateur.pays,
    candidat:
      utilisateur.candidat === null
        ? null
        : {
            id: utilisateur.candidat.id,
            titreProfil: utilisateur.candidat.titreProfil,
            candidatures: utilisateur.candidat._count.candidatures,
          },
    entreprise:
      utilisateur.entreprise === null
        ? null
        : {
            id: utilisateur.entreprise.id,
            nom: utilisateur.entreprise.nom,
            ville: utilisateur.entreprise.ville,
            offres: utilisateur.entreprise._count.offres,
          },
  }
}
