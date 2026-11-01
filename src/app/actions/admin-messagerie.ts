'use server'

import { Prisma } from '@prisma/client'
import { cookies } from 'next/headers'

import {
  ADMIN_ACCES_SIGNALEMENT_TTL_MS,
  creerJetonAccesSignalement,
  nomCookieAccesSignalement,
} from '@/lib/admin-crypto'
import { accesSignalementValide, reauthAdminValide } from '@/lib/admin-reauth'
import { requireAdmin } from '@/lib/dal'
import { consignerAudit } from '@/lib/journal-audit'
import { nettoyerMessage } from '@/lib/messagerie-contenu'
import {
  decisionMasqueMessage,
  decisionSuspendCompte,
  type DecisionSignalement,
} from '@/lib/moderation-labels'
import {
  schemaAccesConversation,
  schemaDecisionSignalement,
  schemaRetablissementMessage,
} from '@/lib/moderation-schemas'
import { notifierDecisionModeration } from '@/lib/notifications-evenements'
import { prisma } from '@/lib/prisma'

// ─── Actions serveur de MODÉRATION admin (M10) ───────────────────────────────
//
// Toutes les actions appellent `requireAdmin()` en PREMIER : un visiteur ou un
// non-admin reçoit le 404 strict du DAL, jamais une redirection qui révélerait
// l'espace. Les actions sensibles vérifient ensuite le grant de
// réauthentification de 5 minutes ; la consultation privée exige EN PLUS un
// grant signé lié au signalement, délivré seulement après un motif fermé et
// une écriture d'audit.
//
//  * `ouvrirConversationSignalement` : motif + réauth -> audit AVANT lecture
//    -> cookie de grant 5 min. La page ne lit les messages qu'avec ce grant.
//  * `deciderSignalement` : réauth + grant de signalement -> décision
//    transactionnelle, masquage append-only, suspension éventuelle, audit.
//  * `retablirMessage` : réauth -> rétablissement append-only + audit.
//
// Aucune exception brute ne sort : les pannes deviennent `inconnue` et les
// logs ne portent jamais de contenu, de note ou d'identité.
// ---------------------------------------------------------------------------

export type ResultatAcces =
  | { ok: true }
  | { ok: false; erreur: 'inconnue' | 'reauth' | 'interdit' }

export type ResultatDecision =
  | { ok: true; deja: boolean; decision?: DecisionSignalement }
  | { ok: false; erreur: 'inconnue' | 'reauth' | 'interdit' }

export type ResultatRetablissement =
  | { ok: true; deja: boolean }
  | { ok: false; erreur: 'inconnue' | 'reauth' | 'interdit' }

function notePropre(note: string | undefined): string | null {
  if (note === undefined) return null
  const nettoyee = nettoyerMessage(note)
  return nettoyee === '' ? null : nettoyee
}

function estErreurSuspensionAdmin(erreur: unknown): boolean {
  return erreur instanceof ErreurSuspensionAdmin
}

class ErreurSuspensionAdmin extends Error {}

/**
 * Ouvre la conversation d'un signalement pour 5 minutes, après motif et
 * réauthentification. L'audit est écrit AVANT la délivrance du grant : sans
 * trace, aucun contenu n'est lisible.
 */
export async function ouvrirConversationSignalement(payload: {
  signalementId: number
  motif: string
}): Promise<ResultatAcces> {
  const session = await requireAdmin()

  if (!(await reauthAdminValide(session.userId))) {
    return { ok: false, erreur: 'reauth' }
  }

  const brut = payload ?? {}
  const parse = schemaAccesConversation.safeParse({
    signalementId: brut.signalementId,
    motif: brut.motif,
  })
  if (!parse.success) return { ok: false, erreur: 'inconnue' }

  try {
    const signalement = await prisma.signalement.findUnique({
      where: { id: parse.data.signalementId },
      select: { id: true, message: { select: { conversationId: true } } },
    })
    if (signalement === null) return { ok: false, erreur: 'inconnue' }

    // Trace immuable AVANT toute lecture du contenu. Le motif vient du
    // catalogue fermé ; aucune donnée du message n'entre dans l'audit.
    await consignerAudit(prisma, {
      acteurId: session.userId,
      action: 'consultation_conversation',
      cibleType: 'signalement',
      cibleId: signalement.id,
      motif: parse.data.motif,
      commentaire: `Conversation ${signalement.message.conversationId}`,
    })

    const cookieStore = await cookies()
    cookieStore.set(
      nomCookieAccesSignalement(signalement.id),
      creerJetonAccesSignalement(session.userId, signalement.id),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(ADMIN_ACCES_SIGNALEMENT_TTL_MS / 1000),
      },
    )
    return { ok: true }
  } catch (erreur) {
    const code =
      erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[admin-moderation] acces', { signalementId: parse.data.signalementId, code })
    return { ok: false, erreur: 'inconnue' }
  }
}

/**
 * Rend une décision sur un signalement. Une seule décision par signalement :
 * le compare-and-set sur `statut: 'ouvert'` rend les clics concurrents
 * idempotents. `masquage` et `suspension` ajoutent une ligne append-only dans
 * `MessageModeration` ; le message lui-même reste immuable.
 */
export async function deciderSignalement(payload: {
  signalementId: number
  decision: string
  motif: string
  noteInterne?: string
}): Promise<ResultatDecision> {
  const session = await requireAdmin()

  if (!(await reauthAdminValide(session.userId))) {
    return { ok: false, erreur: 'reauth' }
  }

  const brut = payload ?? {}
  const parse = schemaDecisionSignalement.safeParse({
    signalementId: brut.signalementId,
    decision: brut.decision,
    motif: brut.motif,
    noteInterne: brut.noteInterne ?? undefined,
  })
  if (!parse.success) return { ok: false, erreur: 'inconnue' }

  // Le contenu n'est décisionnable qu'après la procédure d'accès : motif,
  // réauthentification, audit et grant lié au signalement.
  if (!(await accesSignalementValide(session.userId, parse.data.signalementId))) {
    return { ok: false, erreur: 'interdit' }
  }

  const signalement = await prisma.signalement.findUnique({
    where: { id: parse.data.signalementId },
    select: {
      id: true,
      statut: true,
      auteurId: true,
      messageId: true,
      message: {
        select: {
          senderId: true,
          sender: { select: { id: true, role: true } },
        },
      },
    },
  })
  if (signalement === null) return { ok: false, erreur: 'inconnue' }
  if (signalement.statut !== 'ouvert') {
    return { ok: true, deja: true, decision: parse.data.decision }
  }

  const suspend = decisionSuspendCompte(parse.data.decision)
  if (suspend && signalement.message.sender.role === 'admin') {
    return { ok: false, erreur: 'interdit' }
  }

  const note = notePropre(parse.data.noteInterne)
  const masque = decisionMasqueMessage(parse.data.decision)

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const miseAJour = await tx.signalement.updateMany({
        where: { id: signalement.id, statut: 'ouvert' },
        data: {
          statut: 'traite',
          decision: parse.data.decision,
          motifDecision: parse.data.motif,
          noteInterne: note,
          traiteParId: session.userId,
          traiteLe: new Date(),
        },
      })
      if (miseAJour.count === 0) {
        return { deja: true }
      }

      await consignerAudit(tx, {
        acteurId: session.userId,
        action: 'decision_signalement',
        cibleType: 'signalement',
        cibleId: signalement.id,
        motif: parse.data.motif,
        commentaire: note,
      })

      if (masque) {
        await tx.messageModeration.create({
          data: {
            messageId: signalement.messageId,
            signalementId: signalement.id,
            acteurId: session.userId,
            action: 'masquage',
            motif: parse.data.motif,
            noteInterne: note,
          },
        })
        await consignerAudit(tx, {
          acteurId: session.userId,
          action: 'masquage_message',
          cibleType: 'message',
          cibleId: signalement.messageId,
          motif: parse.data.motif,
          commentaire: note,
        })
      }

      if (suspend) {
        const suspension = await tx.user.updateMany({
          where: {
            id: signalement.message.senderId,
            role: { not: 'admin' },
          },
          data: {
            isActive: false,
            sessionVersion: { increment: 1 },
          },
        })
        if (suspension.count !== 1) {
          throw new ErreurSuspensionAdmin()
        }
        await consignerAudit(tx, {
          acteurId: session.userId,
          action: 'suspension_utilisateur',
          cibleType: 'utilisateur',
          cibleId: signalement.message.senderId,
          motif: parse.data.motif,
          commentaire: note,
        })
      }

      return { deja: false }
    })

    if (!resultat.deja) {
      // Fire-and-forget : la notification ne change jamais le verdict.
      void notifierDecisionModeration({
        signalementId: signalement.id,
        auteurId: signalement.auteurId,
        decision: parse.data.decision,
      })
    }

    return {
      ok: true,
      deja: resultat.deja,
      decision: parse.data.decision,
    }
  } catch (erreur) {
    if (estErreurSuspensionAdmin(erreur)) {
      return { ok: false, erreur: 'interdit' }
    }
    const code =
      erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[admin-moderation] decision', {
      signalementId: parse.data.signalementId,
      code,
    })
    return { ok: false, erreur: 'inconnue' }
  }
}

/**
 * Rétablit un message masqué. L'action ajoute une ligne append-only ; elle ne
 * modifie jamais le message. Une réauthentification récente est exigée et
 * chaque rétablissement est audité.
 */
export async function retablirMessage(payload: {
  messageId: number
  motif: string
  noteInterne?: string
}): Promise<ResultatRetablissement> {
  const session = await requireAdmin()

  if (!(await reauthAdminValide(session.userId))) {
    return { ok: false, erreur: 'reauth' }
  }

  const brut = payload ?? {}
  const parse = schemaRetablissementMessage.safeParse({
    messageId: brut.messageId,
    motif: brut.motif,
    noteInterne: brut.noteInterne ?? undefined,
  })
  if (!parse.success) return { ok: false, erreur: 'inconnue' }

  try {
    const message = await prisma.message.findUnique({
      where: { id: parse.data.messageId },
      select: { id: true },
    })
    if (message === null) return { ok: false, erreur: 'inconnue' }

    const derniere = await prisma.messageModeration.findFirst({
      where: { messageId: message.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { action: true },
    })
    if (derniere?.action !== 'masquage') {
      return { ok: true, deja: true }
    }

    const note = notePropre(parse.data.noteInterne)
    await prisma.$transaction(async (tx) => {
      await consignerAudit(tx, {
        acteurId: session.userId,
        action: 'retablissement_message',
        cibleType: 'message',
        cibleId: message.id,
        motif: parse.data.motif,
        commentaire: note,
      })
      await tx.messageModeration.create({
        data: {
          messageId: message.id,
          acteurId: session.userId,
          action: 'retablissement',
          motif: parse.data.motif,
          noteInterne: note,
        },
      })
    })

    return { ok: true, deja: false }
  } catch (erreur) {
    const code =
      erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[admin-moderation] retablissement', {
      messageId: parse.data.messageId,
      code,
    })
    return { ok: false, erreur: 'inconnue' }
  }
}
