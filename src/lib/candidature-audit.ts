import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import type { StatutCandidature } from '@prisma/client'

// ─── Journal d’audit des candidatures (M7) — table `AuditCandidature` ────────
//
// Écriture centralisée des 4 actions serveur M7 + de la consultation de la
// pièce jointe (route /api/files/cv). Table append-only SANS clé étrangère
// (schema.prisma) : la trace survit à la suppression d’un compte comme à
// celle d’une ligne — « intégrité d’audit > intégrité référentielle ».
//
// NATURE DE L’ÉVÉNEMENT (`action`, colonne VarChar(50)) — 4 valeurs exactes,
// source unique : l’objet `as const` ci-dessous, dont le type union dérive
// (TypeScript strict : aucune 5e valeur n’est exprimable) :
// - `creation`     : postulation créée (postulerOffre) ;
// - `retrait`      : retrait par le candidat (retirerCandidature) ;
// - `transition`   : changement de statut serveur (changerStatutCandidature)
//                    ET le passage automatique `envoyee → consultee` de
//                    marquerConsultee ;
// - `consultation` : lecture de la pièce jointe d’une candidature par un
//                    recruteur ou un admin (route /api/files/cv).
//
// POLITIQUE D’ÉCRITURE (choix d’architecture assumé) :
// - `acteurId` = `session.userId` PARTOUT, JAMAIS `candidat.id` : c’est
//   l’identifiant que logCvAccess (matrice M3/M4) consigne déjà, les deux
//   journaux restent donc rapprochables ;
// - création / retrait / transition : ATOMIQUES AVEC la mutation
//   (fail-closed) — l’appelant passe le client de LA MÊME $transaction et
//   n’écrit l’audit qu’après la réussite du compare-and-set (`count === 1`)
//   ou de la création ; si l’audit échoue, la transaction roule entière :
//   jamais de mutation sans trace ;
// - marquerConsultee : ATOMIQUE mais best-effort — le try/catch global de
//   l’action absorbe tout (y compris l’échec d’audit) : jamais d’exception
//   propagée, jamais de log, la page ne casse pas ;
// - route CV : AVANT diffusion (fail-closed) — sans ligne `consultation`,
//   aucune URL signée n’est produite (même régime que le journal d’accès).
//
// Le client n’est PAS importé mais reçu en argument : l’appelant décide de
// l’atomicité (`prisma` hors transaction, `tx` dedans). Ce module ne rattrape
// JAMAIS une erreur : la politique d’échec appartient à l’appelant.
// ---------------------------------------------------------------------------

/** Source unique des 4 natures — valeurs EXACTES stockées dans `action`. */
const NATURES_AUDIT = {
  creation: 'creation',
  retrait: 'retrait',
  transition: 'transition',
  consultation: 'consultation',
} as const

/** Union dérivée de l’objet `as const` : `'creation' | 'retrait' | … `. */
export type ActionAuditCandidature = (typeof NATURES_AUDIT)[keyof typeof NATURES_AUDIT]

export const ACTION_AUDIT_CREATION = NATURES_AUDIT.creation
export const ACTION_AUDIT_RETRAIT = NATURES_AUDIT.retrait
export const ACTION_AUDIT_TRANSITION = NATURES_AUDIT.transition
export const ACTION_AUDIT_CONSULTATION = NATURES_AUDIT.consultation

/**
 * Entrée de `journaliserCandidature` : `id` et `createdAt` sont produits par
 * la base ; `ancienStatut` vaut `null` à la création et pour une consultation,
 * `nouveauStatut` vaut `null` pour une consultation (aucun changement de
 * statut n’a lieu).
 */
export interface EntreeAuditCandidature {
  candidatureId: number
  acteurId: number
  action: ActionAuditCandidature
  ancienStatut?: StatutCandidature | null
  nouveauStatut?: StatutCandidature | null
}

/**
 * Consigne UN événement d’audit sur `db` — simple écriture append-only, sans
 * contrôle ni rattrapage : le client reçu (client global ou transactif) fixe
 * l’atomicité, et TOUTE erreur se propage à l’appelant (fail-closed par
 * défaut, best-effort uniquement si l’appelant l’organise lui-même).
 */
export async function journaliserCandidature(
  db: PrismaClient | Prisma.TransactionClient,
  entree: EntreeAuditCandidature,
): Promise<void> {
  await db.auditCandidature.create({
    data: {
      candidatureId: entree.candidatureId,
      acteurId: entree.acteurId,
      action: entree.action,
      ancienStatut: entree.ancienStatut ?? null,
      nouveauStatut: entree.nouveauStatut ?? null,
    },
  })
}
