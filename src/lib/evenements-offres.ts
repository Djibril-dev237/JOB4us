import { notifierOffreIndisponible, notifierOffrePubliee } from '@/lib/notifications-evenements'

// ─── Hooks d'événements d'offre (M5/M6) — BRANCHEMENT M9 (Vague 2) ──────────
//
// M9 est branché ICI, jamais dans les actions (même doctrine que
// src/lib/evenements-candidature.ts et src/lib/evenements-messagerie.ts) :
//  * `offrePubliee`      → notification « nouvelle offre » aux admins
//                          (secondaire legacy repris, in-app seul) ;
//  * `offreIndisponible` → notification aux candidats concernés quand une
//                          offre quitte la visibilité (clôturée T4,
//                          supprimée T10, suspendue T8 admin).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma runtime direct, aucun log, aucun 'use server' —
//    ce ne sont pas des actions, ce sont des points d'extension appelés PAR
//    les actions ; le résolveur M9 (`notifications-evenements.ts`) relit la
//    base lui-même (les payloads ne portent que des pointeurs) ;
//  * no-throw au sens strict : les fonctions ne lèvent JAMAIS, ne logent
//    JAMAIS et retournent `void` — les actions M5/M6 ne peuvent pas voir
//    leur verdict modifié par un événement (les échecs sont avalés par le
//    résolveur puis par le cœur d'émission) ;
//  * charge utile = POINTEURS (ids), jamais la ligne complète : le
//    destinataire est relu côté serveur (aucune donnée personnelle ne
//    stagne dans un événement).
//
// Un seul point d'appel par événement, quel que soit le nombre de sites
// métier qui le déclenchent (T4, T8 admin, T10 pour `offreIndisponible`) :
// c'est tout l'intérêt du branchement ici plutôt que dans chaque action.
//
// Hors périmètre : l'EXPIRATION d'une offre (date passée) est un simple
// filtre de lecture en M5/M6, sans action ni job — aucun événement ne la
// déclenche aujourd'hui, M9 ne contourne pas (signalement au compte-rendu).
// ---------------------------------------------------------------------------

/** Charge utile commune : quelle offre, et rien d'autre. */
export interface EvenementOffre {
  offreId: number
}

/**
 * Offre passée de brouillon à publiée (T2/T3) — notification aux admins.
 * Ne part PAS à la réouverture (T5 : clôturée → brouillon, plus rien de
 * visible) ni à la levée de suspension (T9 : la cible est un brouillon).
 */
export function offrePubliee(evenement: EvenementOffre): void {
  // M9 BRANCHÉ (Vague 2) : fire-and-forget, jamais d'exception.
  void notifierOffrePubliee(evenement)
}

/**
 * Offre sortie de la visibilité (clôture T4, suppression T10, suspension
 * T8) — notification aux candidats ayant postulé. Une même offre peut
 * déclencher plusieurs fois cet événement (clôturée PUIS supprimée) :
 * l'idempotence par clé (offreId, destinataire) appartient au cœur
 * d'émission — le rejeu incrémente le compteur, jamais un doublon.
 */
export function offreIndisponible(evenement: EvenementOffre): void {
  // M9 BRANCHÉ (Vague 2) : fire-and-forget, jamais d'exception.
  void notifierOffreIndisponible(evenement)
}
