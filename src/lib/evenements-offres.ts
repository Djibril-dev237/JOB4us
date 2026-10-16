// ─── Hooks d'événements d'offre (M5/M6) — POINT DE BRANCHEMENT M9 ────────────
//
// M9 s'installe ICI, jamais dans les actions (même doctrine que
// src/lib/evenements-candidature.ts et src/lib/evenements-messagerie.ts) :
//  * `offrePubliee`      → notification « nouvelle offre » aux admins
//                          (secondaire legacy repris, in-app seul) ;
//  * `offreIndisponible` → notification aux candidats concernés quand une
//                          offre quitte la visibilité (clôturée T4,
//                          supprimée T10, suspendue T8 admin).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma runtime, aucun log, aucun 'use server' — ce ne
//    sont pas des actions, ce sont des points d'extension appelés PAR les
//    actions ;
//  * no-op silencieux aujourd'hui : les fonctions ne lèvent JAMAIS, ne
//    logent JAMAIS et retournent `void` — les actions M5/M6 ne peuvent
//    pas voir leur verdict modifié par un événement ;
//  * charge utile = POINTEURS (ids), jamais la ligne complète : le futur
//    destinataire relira la base lui-même (aucune donnée personnelle ne
//    stagne dans un événement).
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
 * Offre passée de brouillon à publiée (T2/T3) — M9 prévient les admins.
 * Ne part PAS à la réouverture (T5 : clôturée → brouillon, plus rien de
 * visible) ni à la levée de suspension (T9 : la cible est un brouillon).
 */
export function offrePubliee(_evenement: EvenementOffre): void {
  // no-op (M9) — `void` consomme l'argument du contrat sans logique.
  void _evenement
}

/**
 * Offre sortie de la visibilité (clôture T4, suppression T10, suspension
 * T8) — M9 prévient les candidats ayant postulé. Une même offre peut
 * déclencher plusieurs fois cet événement (clôturée PUIS supprimée) :
 * l'idempotence par clé (offreId, destinataire) appartient à M9.
 */
export function offreIndisponible(_evenement: EvenementOffre): void {
  // no-op (M9) — cf. ci-dessus.
  void _evenement
}
