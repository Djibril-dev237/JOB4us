// ─── Hooks d'événements de messagerie (M8) — POINT DE BRANCHEMENT M9 ────────
//
// M9 s'installera ICI, jamais dans les actions :
//  * `conversationCreee` → notification au recruteur « nouveau échange » ;
//  * `messageEnvoye`     → notification « nouveau message de X » ;
//  * `messageLu`         → acquittement optionnel (M9 arbitre) ;
//  * `signalementRecu`   → notification aux admins « signalement à examiner ».
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma runtime, AUCUN log, aucun 'use server' — ce ne
//    sont pas des actions, ce sont des points d'extension appelés PAR les
//    actions (même doctrine que src/lib/evenements-candidature.ts, M7) ;
//  * no-op silencieux aujourd'hui : les 3 fonctions ne lèvent JAMAIS, ne
//    logent JAMAIS et retournent `void` — les actions M8 ne peuvent donc
//    pas voir leur verdict modifié par un événement ;
//  * charge utile = POINTEURS (ids), jamais le contenu du message : aucune
//    donnée personnelle ne stagne dans un événement ; le futur destinataire
//    relira la base lui-même s'il en a besoin.
//
// Aucune ligne d'audit n'est écrite ici (cf. src/lib/candidature-audit.ts
// pour la doctrine ; l'audit admin de messagerie vit dans AuditConversation).
// ---------------------------------------------------------------------------

/** Nouvelle conversation rattachée à une candidature (créée au postulat). */
export interface EvenementConversationCreee {
  conversationId: number
  candidatureId: number
}

/** Message accepté (nettoyé, en base) — l'événement ne porte JAMAIS le texte. */
export interface EvenementMessageEnvoye {
  conversationId: number
  messageId: number
  emetteurId: number
}

/** Un participant a ouvert la conversation (luLe avancé côté serveur). */
export interface EvenementMessageLu {
  conversationId: number
  lecteurId: number
}

/**
 * Signalement CRÉÉ (et non déjà existant) — pointeurs vers la ligne
 * d'origine (clé unique message × auteur) pour que M9 relise le
 * signalement et resolve ses destinataires admins côté serveur.
 */
export interface EvenementSignalementRecu {
  messageId: number
  auteurId: number
}

/** M9 branchera ICI la notification « nouvelle conversation ». */
export function conversationCreee(_evenement: EvenementConversationCreee): void {
  // no-op (M9) — `void` consomme l'argument du contrat sans logique
  // (la règle no-unused-vars ne couvre pas le préfixe `_` seul).
  void _evenement
}

/** M9 branchera ICI la notification « nouveau message ». */
export function messageEnvoye(_evenement: EvenementMessageEnvoye): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}

/** M9 branchera ICI l'acquittement de lecture, s'il le retient. */
export function messageLu(_evenement: EvenementMessageLu): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}

/** M9 branchera ICI la notification aux admins (modération). */
export function signalementRecu(_evenement: EvenementSignalementRecu): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}
