import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import type { Role } from '@/lib/definitions'

// ─── Session authentifiée (lecture seule) ────────────────────────────────────

export interface AuthedSession {
  userId: number
  role: Role
}

// ─── Vérification de session ──────────────────────────────────────────────────

/**
 * Vérifie que l'utilisateur est authentifié (cookie Auth.js valide).
 * Redirige vers /login si la session est absente, expirée ou si le token
 * ne porte pas les claims attendus (userId + role).
 * Mémoïsée via React cache() pour éviter les lectures multiples par rendu.
 */
export const verifySession = cache(async (): Promise<AuthedSession> => {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role

  if (typeof userId !== 'number' || !role) {
    redirect('/login')
  }

  return { userId, role }
})

// ─── Vérification de rôle ────────────────────────────────────────────────────

/**
 * Vérifie que l'utilisateur authentifié possède l'un des rôles attendus.
 * Redirige vers /unauthorized si le rôle est insuffisant.
 * (Le Proxy Next.js fait déjà ce contrôle en optimistic check ; ce DAL
 * reste le contrôle autoritaire, exécuté côté rendu.)
 */
export const verifyRole = cache(async (...allowedRoles: Role[]): Promise<AuthedSession> => {
  const session = await verifySession()

  if (!allowedRoles.includes(session.role)) {
    redirect('/unauthorized')
  }

  return session
})

// ─── Données utilisateur courant ─────────────────────────────────────────────

/**
 * Récupère l'utilisateur connecté depuis la base de données.
 * Ne retourne que les colonnes nécessaires (DTO minimal, jamais password).
 * Re-vérifie isActive en base : une désactivation prise en compte même si
 * le cookie de session est encore valide.
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

  // Compte supprimé ou désactivé entre-temps
  if (!user || !user.isActive) {
    redirect('/login')
  }

  return user
})
