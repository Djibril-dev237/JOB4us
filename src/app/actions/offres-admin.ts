'use server'

import { notFound, redirect } from 'next/navigation'

import { reauthAdminValide } from '@/lib/admin-reauth'
import { requireAdmin } from '@/lib/dal'
import { offreIndisponible } from '@/lib/evenements-offres'
import { formDataString } from '@/lib/form-errors'
import { consignerAudit } from '@/lib/journal-audit'
import { lireOffrePourAdmin } from '@/lib/offres-dal'
import { prisma } from '@/lib/prisma'

// ─── Actions admin des offres (M6, Vague 2 — T8/T9) ──────────────────────────
//
// Ordre imposé par la doctrine 404 (jamais de 403) :
//   1. rôle      : verifyRole('admin') — gate autoritaire, aucun accès
//                  silencieux, avant TOUTE lecture ;
//   2. existence : lireOffrePourAdmin(id) → null → notFound() — inexistante
//                  ET supprimée logiquement produisent le même 404, sans
//                  indice d'existence ;
//   3. transition: compare-and-set — le statut source vit DANS le `where`
//                  de l'updateMany, jamais une lecture puis une écriture
//                  séparées pour décider (fenêtre de course).
//
// Sécurité payload : le statut cible vient UNIQUEMENT de la matrice T8/T9
// (littéraux ci-dessous) ; ni statut, ni entrepriseId, ni deletedAt ne sont
// lus du FormData — un champ forge n'a donc aucun effet. L'écriture est un
// `updateMany` (jamais un spread de données reçues).
//
// Réponses : REDIRECTION, jamais de FormState (motif du repo : le redirect
// throw, on ne retourne donc jamais de `message`). Succès → `?maj=`,
// refus de la matrice → `?erreur=statut`, les deux résolus par la page
// /admin/offres via messageMaj() / messageErreurTransition() (fail-closed).
// ---------------------------------------------------------------------------

/**
 * Id d'offre lu dans le FormData : entier STRICTEMENT positif, sinon 404.
 *
 * `formDataString` renvoie '' pour un champ absent ou non-texte, et
 * `Number('')` vaut 0 — d'où la double garde `isSafeInteger && > 0`, qui
 * élimine aussi 'abc', '12.5', '-3', NaN, Infinity et les entiers hors de
 * la plage sûre de JS. Le 404 est volontairement IDENTIQUE à celui d'une
 * offre réellement absente : un id forgé ne doit révéler rien du tout.
 */
function identifierOffre(formData: FormData): number {
  const id = Number(formDataString(formData.get('id')).trim())
  if (!Number.isSafeInteger(id) || id <= 0) {
    notFound()
  }
  return id
}

/**
 * T8 — Suspendre une offre (admin).
 *
 * Source autorisée : `publiee`, `brouillon` ou `cloturee` (jamais déjà
 * `suspendue` : count 0 → refus). `deletedAt: null` interdit de suspendre
 * une offre supprimée entre la lecture et l'écriture. PAS d'`entrepriseId`
 * dans le where : l'admin voit toutes les offres.
 */
export async function suspendreOffre(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  if (!(await reauthAdminValide(session.userId))) {
    redirect('/admin/reauth?retour=%2Fadmin%2Foffres')
  }

  const id = identifierOffre(formData)
  const offre = await lireOffrePourAdmin(id)
  if (offre === null) {
    notFound()
  }

  // Trace AVANT l'effet : une suspension sans audit n'a pas lieu d'être.
  await consignerAudit(prisma, {
    acteurId: session.userId,
    action: 'suspension_offre',
    cibleType: 'offre',
    cibleId: id,
    motif: 'autre',
  })

  const resultat = await prisma.offre.updateMany({
    where: { id, deletedAt: null, statut: { in: ['publiee', 'brouillon', 'cloturee'] } },
    data: { statut: 'suspendue' },
  })
  if (resultat.count === 0) {
    redirect('/admin/offres?erreur=statut')
  }

  // Événement M9 (hook branché) : la suspension retire l'offre de la
  // visibilité — les candidats concernés seront prévenus (la levée T9,
  // cible brouillon, n'émet rien : rien n'est de nouveau visible).
  offreIndisponible({ offreId: id })

  redirect('/admin/offres?maj=suspendue')
}

/**
 * T9 — Lever une suspension (admin).
 *
 * Source UNIQUE : `suspendue` ; cible fixée par la matrice : `brouillon`
 * (et non « le statut d'avant » — la matrice ne connaît pas l'historique).
 * Le même CAS sert de contrôle de course : si une autre requête a déjà
 * relevé l'offre, count 0 → refus, sans jamais réécrire deux fois.
 */
export async function releverOffre(formData: FormData): Promise<void> {
  const session = await requireAdmin()
  if (!(await reauthAdminValide(session.userId))) {
    redirect('/admin/reauth?retour=%2Fadmin%2Foffres')
  }

  const id = identifierOffre(formData)
  const offre = await lireOffrePourAdmin(id)
  if (offre === null) {
    notFound()
  }

  await consignerAudit(prisma, {
    acteurId: session.userId,
    action: 'reactivation_offre',
    cibleType: 'offre',
    cibleId: id,
    motif: 'autre',
  })

  const resultat = await prisma.offre.updateMany({
    where: { id, deletedAt: null, statut: 'suspendue' },
    data: { statut: 'brouillon' },
  })
  if (resultat.count === 0) {
    redirect('/admin/offres?erreur=statut')
  }

  redirect('/admin/offres?maj=levee')
}
