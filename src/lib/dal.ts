import 'server-only'

import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type { Role } from '@/lib/definitions'

// ─── Session authentifiée (lecture seule) ────────────────────────────────────

export interface AuthedSession {
  userId: number
  role: Role
  /**
   * Version de session lue en base au moment de la connexion (M10).
   * Optionnelle dans le type public pour ne pas casser les doubles de test
   * historiques ; la session réellement chargée la porte toujours.
   */
  sessionVersion?: number
}

export interface AdminSession extends AuthedSession {
  role: 'admin'
  sessionVersion: number
}

interface SessionAutoritaire extends AuthedSession {
  sessionVersion: number
  totpEnabledAt: Date | null
}

// ─── Chargement autoritaire de la session ────────────────────────────────────
//
// Le JWT n'est qu'un porteur d'identité : la source de vérité reste la base.
// Chaque lecture vérifie isActive, le rôle, l'absence d'anonymisation et la
// version de session. Une suspension incrémente sessionVersion : le cookie
// encore présent ne vaut plus rien au rendu suivant.
// ---------------------------------------------------------------------------

const chargerSession = cache(async (): Promise<SessionAutoritaire | null> => {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  const sessionVersion = session?.user?.sessionVersion

  if (
    typeof userId !== 'number' ||
    !role ||
    typeof sessionVersion !== 'number'
  ) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      sessionVersion: true,
      anonymizedAt: true,
      totpEnabledAt: true,
    },
  })

  if (
    !user ||
    !user.isActive ||
    user.anonymizedAt !== null ||
    user.role !== role ||
    user.sessionVersion !== sessionVersion
  ) {
    return null
  }

  return {
    userId,
    role: user.role,
    sessionVersion: user.sessionVersion,
    totpEnabledAt: user.totpEnabledAt,
  }
})

// ─── Vérification de session ─────────────────────────────────────────────────

/**
 * Vérifie que l'utilisateur est authentifié et que la base confirme encore
 * la session. Redirige vers /login si la session est absente, expirée,
 * suspendue, anonymisée ou si la version ne correspond plus.
 * Mémoïsée via React cache() pour éviter les lectures multiples par rendu.
 */
export const verifySession = cache(async (): Promise<AuthedSession> => {
  const session = await chargerSession()
  if (!session) redirect('/login')
  return {
    userId: session.userId,
    role: session.role,
    sessionVersion: session.sessionVersion,
  }
})

// ─── Vérification de rôle ────────────────────────────────────────────────────

/**
 * Vérifie que l'utilisateur authentifié possède l'un des rôles attendus.
 * Redirige vers /unauthorized si le rôle est insuffisant.
 * Le Proxy Next.js fait un contrôle optimiste ; ce DAL reste le contrôle
 * autoritaire, exécuté côté rendu et côté action.
 */
export const verifyRole = cache(async (...allowedRoles: Role[]): Promise<AuthedSession> => {
  const session = await verifySession()
  if (!allowedRoles.includes(session.role)) redirect('/unauthorized')
  return session
})

// ─── Garde administrateur stricte (M10) ──────────────────────────────────────
//
// Toute page et toute Server Action /admin appellent requireAdmin(). Un
// visiteur, un candidat, un recruteur, un admin suspendu ou un admin sans
// TOTP activé reçoit le MÊME 404 : aucune redirection vers /login ou
// /unauthorized ne révèle l'existence de l'espace. Le contrôle est
// volontairement séparé de verifySession(), qui redirige pour les espaces
// métier ordinaires.
// ---------------------------------------------------------------------------

export const requireAdmin = cache(async (): Promise<AdminSession> => {
  const session = await chargerSession()
  if (
    !session ||
    session.role !== 'admin' ||
    session.totpEnabledAt === null
  ) {
    notFound()
  }
  return {
    userId: session.userId,
    role: 'admin',
    sessionVersion: session.sessionVersion,
  }
})

// ─── Données utilisateur courant ─────────────────────────────────────────────

/**
 * Récupère l'utilisateur connecté depuis la base de données.
 * Ne retourne que les colonnes nécessaires (DTO minimal, jamais password).
 * La vérification de session a déjà revalidé isActive, rôle et version.
 * Mémoïsée pour éviter plusieurs requêtes par rendu.
 */
export const getCurrentUser = cache(async () => {
  const session = await verifySession()

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  })

  if (!user || !user.isActive) redirect('/login')
  return user
})
