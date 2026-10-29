import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'

import {
  ADMIN_CHALLENGE_TTL_MS,
  ADMIN_FENETRE_OTP_MS,
  ADMIN_MAX_TENTATIVES_OTP,
  estCodeTotp,
  genererJeton,
  hacherCodeRecuperation,
  hacherJeton,
  verifierCodeTotp,
  dechiffrerSecretTotp,
} from '@/lib/admin-crypto'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, recordAttempt, resetAttempts } from '@/lib/rate-limit'

// ─── Authentification admin à deux étapes (M10) ─────────────────────────────
//
// Étape 1 (mot de passe) : l'action de connexion vérifie le mot de passe et
// crée un challenge en base. Le jeton du challenge n'est jamais renvoyé au
// client : il vit dans un cookie httpOnly, et la base n'en garde que le hash.
//
// Étape 2 (TOTP ou code de récupération) : le provider Auth.js
// `admin-challenge` consomme le challenge UNE fois, vérifie le code, met à
// jour `totpLastStep` (anti-rejeu) ou consomme le code de récupération, puis
// retourne l'utilisateur à Auth.js. Une course entre deux onglets est refusée
// par les `updateMany` conditionnels de la transaction.
//
// Le provider credentials ordinaire REFUSE les admins : un POST direct sur
// /api/auth/callback/credentials ne peut donc pas contourner l'étape 2.
// ---------------------------------------------------------------------------

export interface UtilisateurChallengeAdmin {
  id: string
  name: string
  email: string | undefined
  role: 'admin'
  sessionVersion: number
}

export interface ChallengeAdminLisible {
  id: string
  userId: number
  expiresAt: Date
  user: { name: string; email: string | null }
}

const MESSAGE_CONCURRENCE = 'challenge-admin-concurrence'

class ErreurConcurrenceAdmin extends Error {
  constructor() {
    super(MESSAGE_CONCURRENCE)
  }
}

/**
 * Crée un challenge de 5 minutes et invalide les challenges encore ouverts du
 * même compte. Le jeton en clair est retourné à l'appelant pour le cookie
 * httpOnly ; il n'est jamais journalisé.
 */
export async function creerChallengeAdmin(
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = genererJeton()
  const tokenHash = hacherJeton(token)
  const maintenant = new Date()
  const expiresAt = new Date(maintenant.getTime() + ADMIN_CHALLENGE_TTL_MS)

  await prisma.$transaction(async (tx) => {
    await tx.adminAuthChallenge.updateMany({
      where: {
        userId,
        consumedAt: null,
        expiresAt: { gt: maintenant },
      },
      data: { consumedAt: maintenant },
    })
    await tx.adminAuthChallenge.create({
      data: { userId, tokenHash, expiresAt },
    })
  })

  return { token, expiresAt }
}

/** Lecture non sensible pour la page /login/2fa (aucun secret TOTP). */
export async function lireChallengeAdmin(
  token: string | null | undefined,
): Promise<ChallengeAdminLisible | null> {
  if (!token) return null
  const challenge = await prisma.adminAuthChallenge.findUnique({
    where: { tokenHash: hacherJeton(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
      user: {
        select: {
          name: true,
          email: true,
          role: true,
          isActive: true,
          totpEnabledAt: true,
          anonymizedAt: true,
        },
      },
    },
  })
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt.getTime() <= Date.now() ||
    challenge.user.role !== 'admin' ||
    !challenge.user.isActive ||
    challenge.user.totpEnabledAt === null ||
    challenge.user.anonymizedAt !== null
  ) {
    return null
  }
  return {
    id: challenge.id,
    userId: challenge.userId,
    expiresAt: challenge.expiresAt,
    user: { name: challenge.user.name, email: challenge.user.email },
  }
}

interface ChallengePourVerification {
  id: string
  userId: number
  expiresAt: Date
  consumedAt: Date | null
  user: {
    id: number
    name: string
    email: string | null
    role: 'admin'
    isActive: boolean
    sessionVersion: number
    totpSecret: string | null
    totpEnabledAt: Date | null
    totpLastStep: number | null
    anonymizedAt: Date | null
  }
}

function challengeValide(
  challenge: ChallengePourVerification | null,
): challenge is ChallengePourVerification {
  return (
    challenge !== null &&
    challenge.consumedAt === null &&
    challenge.expiresAt.getTime() > Date.now() &&
    challenge.user.role === 'admin' &&
    challenge.user.isActive &&
    challenge.user.totpEnabledAt !== null &&
    challenge.user.totpSecret !== null &&
    challenge.user.anonymizedAt === null
  )
}

function resultatUtilisateur(
  user: ChallengePourVerification['user'],
): UtilisateurChallengeAdmin {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email ?? undefined,
    role: 'admin',
    sessionVersion: user.sessionVersion,
  }
}

/**
 * Vérifie le second facteur d'un challenge. Retourne l'utilisateur Auth.js ou
 * null. Toute erreur de concurrence (challenge déjà consommé, pas TOTP déjà
 * utilisé, code de récupération déjà consommé) est un refus silencieux.
 */
export async function verifierChallengeAdmin(credentials: {
  challengeToken?: unknown
  code?: unknown
}): Promise<UtilisateurChallengeAdmin | null> {
  const challengeToken =
    typeof credentials.challengeToken === 'string' ? credentials.challengeToken : ''
  const code = typeof credentials.code === 'string' ? credentials.code.trim() : ''
  if (!challengeToken || !code) return null

  const challenge = (await prisma.adminAuthChallenge.findUnique({
    where: { tokenHash: hacherJeton(challengeToken) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          sessionVersion: true,
          totpSecret: true,
          totpEnabledAt: true,
          totpLastStep: true,
          anonymizedAt: true,
        },
      },
    },
  })) as ChallengePourVerification | null

  if (!challengeValide(challenge)) return null

  const cleRateLimit = `admin:otp:${challenge.id}`
  const limite = checkRateLimit(
    cleRateLimit,
    ADMIN_MAX_TENTATIVES_OTP,
    ADMIN_FENETRE_OTP_MS,
  )
  if (!limite.allowed) return null

  const utilisateur = challenge.user
  const maintenant = new Date()

  try {
    if (estCodeTotp(code)) {
      const secret = dechiffrerSecretTotp(utilisateur.totpSecret as string)
      const verification = verifierCodeTotp(secret, code, utilisateur.totpLastStep)
      if (!verification.valide || verification.pas === undefined) {
        recordAttempt(cleRateLimit, ADMIN_FENETRE_OTP_MS)
        return null
      }

      await prisma.$transaction(async (tx) => {
        const challengeConsomme = await tx.adminAuthChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            expiresAt: { gt: maintenant },
          },
          data: { consumedAt: maintenant },
        })
        if (challengeConsomme.count !== 1) throw new ErreurConcurrenceAdmin()

        const utilisateurMisAJour = await tx.user.updateMany({
          where: {
            id: utilisateur.id,
            role: 'admin',
            isActive: true,
            totpLastStep: utilisateur.totpLastStep,
          },
          data: { totpLastStep: verification.pas },
        })
        if (utilisateurMisAJour.count !== 1) throw new ErreurConcurrenceAdmin()
      })

      resetAttempts(cleRateLimit)
      return resultatUtilisateur(utilisateur)
    }

    // Code de récupération : 10 caractères normalisés, hash stocké.
    const codeNormalise = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (codeNormalise.length < 8) {
      recordAttempt(cleRateLimit, ADMIN_FENETRE_OTP_MS)
      return null
    }
    const codeHash = hacherCodeRecuperation(codeNormalise)
    const codeRecuperation = await prisma.adminRecoveryCode.findFirst({
      where: { userId: utilisateur.id, codeHash, usedAt: null },
      select: { id: true },
    })
    if (!codeRecuperation) {
      recordAttempt(cleRateLimit, ADMIN_FENETRE_OTP_MS)
      return null
    }

    await prisma.$transaction(async (tx) => {
      const codeConsomme = await tx.adminRecoveryCode.updateMany({
        where: { id: codeRecuperation.id, usedAt: null },
        data: { usedAt: maintenant },
      })
      if (codeConsomme.count !== 1) throw new ErreurConcurrenceAdmin()

      const challengeConsomme = await tx.adminAuthChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: maintenant },
        },
        data: { consumedAt: maintenant },
      })
      if (challengeConsomme.count !== 1) throw new ErreurConcurrenceAdmin()
    })

    resetAttempts(cleRateLimit)
    return resultatUtilisateur(utilisateur)
  } catch (error) {
    if (error instanceof ErreurConcurrenceAdmin) return null
    throw error
  }
}

/**
 * Vérifie un code pour une session admin déjà ouverte (réauthentification).
 * Accepte TOTP ou code de récupération ; met à jour l'anti-rejeu ou consomme
 * le code. Retourne false pour toute erreur métier, sans révéler la cause.
 */
export async function verifierCodeAdminPourSession(
  userId: number,
  code: string,
): Promise<boolean> {
  const utilisateur = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      totpSecret: true,
      totpEnabledAt: true,
      totpLastStep: true,
      anonymizedAt: true,
    },
  })
  if (
    !utilisateur ||
    utilisateur.role !== 'admin' ||
    !utilisateur.isActive ||
    utilisateur.totpEnabledAt === null ||
    utilisateur.totpSecret === null ||
    utilisateur.anonymizedAt !== null
  ) {
    return false
  }

  const maintenant = new Date()
  if (estCodeTotp(code)) {
    const secret = dechiffrerSecretTotp(utilisateur.totpSecret)
    const verification = verifierCodeTotp(secret, code, utilisateur.totpLastStep)
    if (!verification.valide || verification.pas === undefined) return false
    const miseAJour = await prisma.user.updateMany({
      where: {
        id: utilisateur.id,
        role: 'admin',
        isActive: true,
        totpLastStep: utilisateur.totpLastStep,
      },
      data: { totpLastStep: verification.pas },
    })
    return miseAJour.count === 1
  }

  const codeNormalise = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (codeNormalise.length < 8) return false
  const codeHash = hacherCodeRecuperation(codeNormalise)
  const codeRecuperation = await prisma.adminRecoveryCode.findFirst({
    where: { userId: utilisateur.id, codeHash, usedAt: null },
    select: { id: true },
  })
  if (!codeRecuperation) return false
  const consommation = await prisma.adminRecoveryCode.updateMany({
    where: { id: codeRecuperation.id, usedAt: null },
    data: { usedAt: maintenant },
  })
  return consommation.count === 1
}

/** Nombre d'admins réellement actifs (activés, non suspendus, non anonymisés). */
export async function compterAdminsActifs(
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<number> {
  return db.user.count({
    where: {
      role: 'admin',
      isActive: true,
      totpEnabledAt: { not: null },
      anonymizedAt: null,
    },
  })
}
