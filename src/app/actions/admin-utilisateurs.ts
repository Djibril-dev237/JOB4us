'use server'

import { notFound, redirect } from 'next/navigation'

import { reauthAdminValide } from '@/lib/admin-reauth'
import {
  schemaReactivationUtilisateur,
  schemaSuspensionUtilisateur,
} from '@/lib/admin-gestion-schemas'
import { requireAdmin } from '@/lib/dal'
import { formDataString } from '@/lib/form-errors'
import { consignerAudit } from '@/lib/journal-audit'
import { nettoyerMessage } from '@/lib/messagerie-contenu'
import { prisma } from '@/lib/prisma'

// ─── Actions de gestion des comptes (M10) ───────────────────────────────────
//
// Ordre strict : `requireAdmin()` -> identifiant -> schéma fermé -> réauth ->
// existence -> règles métier -> transaction (CAS + audit). Un compte admin
// n'est JAMAIS suspendu : cette règle protège structurellement le dernier
// administrateur actif, y compris contre un appel direct à l'action. La
// suspension incrémente `sessionVersion`, donc la session ouverte est
// invalidée au rendu suivant par `requireAdmin`/`verifySession`.
// ---------------------------------------------------------------------------

function idUtilisateur(formData: FormData): number {
  const brut = formDataString(formData.get('userId'))
  const id = Number(brut)
  if (!/^[1-9][0-9]*$/.test(brut) || !Number.isSafeInteger(id)) notFound()
  return id
}

function notePropre(note: string | undefined): string | null {
  if (note === undefined) return null
  const nettoyee = nettoyerMessage(note)
  return nettoyee === '' ? null : nettoyee
}

function retourDetail(userId: number, requete?: string): string {
  return `/admin/utilisateurs/${userId}${requete ? `?${requete}` : ''}`
}

export async function suspendreUtilisateur(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const userId = idUtilisateur(formData)

  const parse = schemaSuspensionUtilisateur.safeParse({
    userId,
    motif: formDataString(formData.get('motif')),
    noteInterne: formDataString(formData.get('noteInterne')) || undefined,
  })
  if (!parse.success) {
    redirect(retourDetail(userId, 'erreur=forme'))
  }

  if (!(await reauthAdminValide(session.userId))) {
    redirect(`/admin/reauth?retour=${encodeURIComponent(retourDetail(userId))}`)
  }

  const cible = await prisma.user.findUnique({
    where: { id: parse.data.userId },
    select: { id: true, role: true, isActive: true, anonymizedAt: true },
  })
  if (cible === null) notFound()

  // Les comptes admin sont en lecture seule. Cette branche couvre aussi le
  // dernier admin actif : aucun admin ne peut être suspendu par l'interface.
  if (cible.role === 'admin') {
    redirect(retourDetail(cible.id, 'erreur=admin'))
  }
  if (cible.anonymizedAt !== null) {
    redirect(retourDetail(cible.id, 'erreur=anonymise'))
  }
  if (!cible.isActive) {
    redirect(retourDetail(cible.id, 'erreur=deja_suspendu'))
  }

  const note = notePropre(parse.data.noteInterne)
  let applique = false
  try {
    applique = await prisma.$transaction(async (tx) => {
      const miseAJour = await tx.user.updateMany({
        where: {
          id: cible.id,
          role: { not: 'admin' },
          isActive: true,
          anonymizedAt: null,
        },
        data: {
          isActive: false,
          sessionVersion: { increment: 1 },
        },
      })
      if (miseAJour.count !== 1) return false

      await consignerAudit(tx, {
        acteurId: session.userId,
        action: 'suspension_utilisateur',
        cibleType: 'utilisateur',
        cibleId: cible.id,
        motif: parse.data.motif,
        commentaire: note,
      })
      return true
    })
  } catch {
    redirect(retourDetail(cible.id, 'erreur=inconnue'))
  }

  if (!applique) redirect(retourDetail(cible.id, 'erreur=statut'))
  redirect(retourDetail(cible.id, 'maj=suspendu'))
}

export async function reactiverUtilisateur(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  const userId = idUtilisateur(formData)

  const parse = schemaReactivationUtilisateur.safeParse({
    userId,
    motif: formDataString(formData.get('motif')),
    noteInterne: formDataString(formData.get('noteInterne')) || undefined,
  })
  if (!parse.success) {
    redirect(retourDetail(userId, 'erreur=forme'))
  }

  if (!(await reauthAdminValide(session.userId))) {
    redirect(`/admin/reauth?retour=${encodeURIComponent(retourDetail(userId))}`)
  }

  const cible = await prisma.user.findUnique({
    where: { id: parse.data.userId },
    select: { id: true, role: true, isActive: true, anonymizedAt: true },
  })
  if (cible === null) notFound()

  if (cible.role === 'admin') {
    redirect(retourDetail(cible.id, 'erreur=admin'))
  }
  if (cible.anonymizedAt !== null) {
    redirect(retourDetail(cible.id, 'erreur=anonymise'))
  }
  if (cible.isActive) {
    redirect(retourDetail(cible.id, 'erreur=deja_actif'))
  }

  const note = notePropre(parse.data.noteInterne)
  let applique = false
  try {
    applique = await prisma.$transaction(async (tx) => {
      const miseAJour = await tx.user.updateMany({
        where: {
          id: cible.id,
          role: { not: 'admin' },
          isActive: false,
          anonymizedAt: null,
        },
        data: { isActive: true },
      })
      if (miseAJour.count !== 1) return false

      await consignerAudit(tx, {
        acteurId: session.userId,
        action: 'reactivation_utilisateur',
        cibleType: 'utilisateur',
        cibleId: cible.id,
        motif: parse.data.motif,
        commentaire: note,
      })
      return true
    })
  } catch {
    redirect(retourDetail(cible.id, 'erreur=inconnue'))
  }

  if (!applique) redirect(retourDetail(cible.id, 'erreur=statut'))
  redirect(retourDetail(cible.id, 'maj=reactive'))
}
