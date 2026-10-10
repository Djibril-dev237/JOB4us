import type { StatutCandidature } from '@prisma/client'

// ─── Hooks d'événements de candidature (M7) — POINT DE BRANCHEMENT M8 / M9 ───
//
// Les modules futurs s'installent ICI, jamais dans les actions :
//  * M8 : message du recruteur à la postulation → branchement dans
//    `candidatureEnvoyee` ;
//  * M9 : notification au candidat d'un changement de statut → branchement
//    dans `statutChange` (et, si M9 le décide, `candidatureRetiree`).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma runtime (uniquement les `type` ci-dessous), AUCUN
//    log, aucun 'use server' : ce ne sont pas des actions, ce sont des
//    points d'extension appelés PAR les actions ;
//  * no-op silencieux aujourd'hui : les 3 fonctions ne lèvent JAMAIS, ne
//    logent JAMAIS et retournent `void` — les actions M7 ne peuvent donc
//    pas voir leur verdict (redirect) modifié par un événement ;
//  * la charge utile est un POINTEUR (ids + statuts), jamais la ligne
//    complète : le futur destinataire relira lui-même la base s'il en a
//    besoin (aucune donnée personnelle ne stagne dans un événement).
//
// Aucune ligne d’audit n’est écrite ici (cf. src/lib/candidature-audit.ts).
// ---------------------------------------------------------------------------

/** Charge utile commune : quelle candidature, pour quelle offre, de quel candidat. */
export interface EvenementCandidature {
  candidatureId: number
  offreId: number
  candidatId: number
}

/** Changement de statut : la charge ajoute l'ancien/nouveau statut et l'acteur. */
export interface EvenementStatutChange extends EvenementCandidature {
  ancienStatut: StatutCandidature
  nouveauStatut: StatutCandidature
  acteurId: number
}

/** M8 branchera ICI l'envoi du message recruteur à la postulation. */
export function candidatureEnvoyee(_evenement: EvenementCandidature): void {
  // no-op (M8) — `void` : consomme l'argument du contrat sans logique
  // (la règle no-unused-vars ne couvre pas ici le préfixe `_` seul).
  void _evenement
}

/** Retrait par le candidat : M9 pourra prévenir le recruteur si besoin. */
export function candidatureRetiree(_evenement: EvenementCandidature): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}

/** M9 branchera ICI la notification au candidat (ancien → nouveau statut). */
export function statutChange(_evenement: EvenementStatutChange): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}
