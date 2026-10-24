import { notifierMessageEnvoye, notifierSignalementRecu } from '@/lib/notifications-evenements'

// ─── Hooks d'événements de messagerie (M8) — BRANCHEMENT M9 (Vague 2) ───────
//
// M9 est branché ICI, jamais dans les actions :
//  * `conversationCreee` → no-op DOCUMENTÉ (arbitrage ci-dessous) ;
//  * `messageEnvoye`     → notification « nouveau message de X » à l'autre
//                          participant (BRANCHÉ) ;
//  * `messageLu`         → no-op DOCUMENTÉ (acquittement = bruit) ;
//  * `signalementRecu`   → notification aux admins « signalement à
//                          examiner » (BRANCHÉ, non désactivable).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma runtime, AUCUN log, aucun 'use server' — ce ne
//    sont pas des actions, ce sont des points d'extension appelés PAR les
//    actions (même doctrine que src/lib/evenements-candidature.ts, M7) ;
//    le résolveur M9 (`notifications-evenements.ts`) relit la base lui-même ;
//  * no-op no-throw au sens strict : les fonctions ne lèvent JAMAIS, ne
//    logent JAMAIS et retournent `void` — les actions M8 ne peuvent donc
//    pas voir leur verdict modifié par un événement (les échecs des
//    branches sont avalés par leurs résolveurs) ;
//  * charge utile = POINTEURS (ids), jamais le contenu du message : aucune
//    donnée personnelle ne stagne dans un événement ; le destinataire est
//    relu côté serveur.
//
// ARBITRAGES M9 (Vague 2) :
//  * `conversationCreee` n'émet PAS : le recruteur est prévenu par
//    `candidatureRecue` (branche de evenements-candidature) au moment du
//    postulat — lier sa notification à la réussite de la création de
//    conversation serait un couplage fautif, et `messageEnvoye` couvre
//    chaque message ensuite ;
//  * `messageLu` n'émet PAS : un acquittement de lecture n'est pas une
//    notification (bruit permanent pour un état déjà visible dans la
//    conversation).
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
 * d'origine (clé unique message × auteur) : le résolveur M9 relit les
 * destinataires admins côté serveur.
 */
export interface EvenementSignalementRecu {
  messageId: number
  auteurId: number
}

/** No-op documenté (arbitrage M9) : la notification recruteur vit ailleurs. */
export function conversationCreee(_evenement: EvenementConversationCreee): void {
  // no-op — `void` consomme l'argument du contrat sans logique
  // (la règle no-unused-vars ne couvre pas le préfixe `_` seul).
  void _evenement
}

/** M9 BRANCHÉ (Vague 2) : notification à l'AUTRE participant. */
export function messageEnvoye(evenement: EvenementMessageEnvoye): void {
  // Fire-and-forget : jamais d'exception, jamais de verdict touché.
  void notifierMessageEnvoye(evenement)
}

/** No-op documenté (arbitrage M9) : un acquittement n'est pas une notif. */
export function messageLu(_evenement: EvenementMessageLu): void {
  // no-op — cf. l'arbitrage en tête de fichier.
  void _evenement
}

/** M9 BRANCHÉ (Vague 2) : notification à CHAQUE admin (modération). */
export function signalementRecu(evenement: EvenementSignalementRecu): void {
  // Fire-and-forget : jamais d'exception, jamais de verdict touché.
  void notifierSignalementRecu(evenement)
}
