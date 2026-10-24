import type { StatutCandidature } from '@prisma/client'

import { conversationCreee } from '@/lib/evenements-messagerie'
import { creerConversationDepuisCandidature } from '@/lib/messagerie-creation'
import {
  notifierCandidatureRecue,
  notifierCandidatureRetiree,
  notifierStatutChange,
} from '@/lib/notifications-evenements'

// ─── Hooks d'événements de candidature (M7) — BRANCHEMENTS M8 / M9 ──────────
//
// Les modules sont branchés ICI, jamais dans les actions :
//  * M8 (BRANCHÉ, Vague 2) : création de la conversation-cadre à l'envoi →
//    dans `candidatureEnvoyee` ;
//  * M9 (BRANCHÉ, Vague 2) : notification « Nouvelle candidature » au
//    recruteur (dans `candidatureEnvoyee`), notification du candidat sur
//    changement de statut (`statutChange`) et notification du recruteur sur
//    retrait (`candidatureRetiree`).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma DIRECT (uniquement les `type` ci-dessous) — les
//    résolveurs branchés (messagerie-creation, notifications-evenements)
//    sont des libs serveur propriétaires de leur propre connexion ; aucun
//    'use server' ici : ce ne sont pas des actions, ce sont des points
//    d'extension appelés PAR les actions ;
//  * JAMAIS d'exception, JAMAIS de log, toujours `void` : les actions M7 ne
//    peuvent pas voir leur verdict modifié par un événement — les chemins
//    d'échec des branches sont avalés sur place (cf. `candidatureEnvoyee`) ;
//  * la charge utile est un POINTEUR (ids + statuts), jamais la ligne
//    complète : le destinataire est relu côté serveur (aucune donnée
//    personnelle ne stagne dans un événement).
//
// ARBITRAGE M9 : `candidatureRecue` émet depuis `candidatureEnvoyee` et NON
// depuis `conversationCreee` — « un candidat a postulé » reste vrai même si
// la création de conversation échoue ; lier la notification recruteur au
// succès de la messagerie serait un couplage fautif.
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

/** M8 BRANCHÉ (Vague 2) : la conversation-cadre naît avec l'envoi. */
export function candidatureEnvoyee(evenement: EvenementCandidature): void {
  // M9 BRANCHÉ (Vague 2) : notification « Nouvelle candidature » au
  // recruteur, ÉMISE INDÉPENDAMMENT du succès de la conversation — « un
  // candidat a postulé » est vrai même si la branche M8 ci-dessous échoue.
  // Fire-and-forget : jamais d'exception, jamais de verdict touché.
  void notifierCandidatureRecue(evenement)

  // UNE conversation par candidature, créée AU MOMENT où la candidature
  // devient visible : les deux parties écrivent sans aucune action
  // d'ouverture (Étape 2 validée). Fire-and-forget au sens strict du
  // contrat : jamais d'exception, jamais de log — un raté de base au pire
  // moment (entre l'écriture de la candidature et celle de la
  // conversation) laisse la conversation absente, écart assumé et
  // documenté plutôt que de risquer un verdict M7 retourné.
  void creerConversationDepuisCandidature(evenement.candidatureId)
    .then((conversationId) => {
      // Événement M8 : une SEULE fois par conversation créée — le chemin
      // P2002 (course, déjà créée) ne le déclenche pas.
      if (conversationId !== null) {
        conversationCreee({ conversationId, candidatureId: evenement.candidatureId })
      }
    })
    .catch(() => {
      // Échec DB absorbé : contrat no-throw/no-log du module. Voir plus
      // haut l'écart assumé — aucune décision utilisateur n'en dépend.
    })
}

/** M9 BRANCHÉ : le recruteur (propriétaire courant) est prévenu du retrait. */
export function candidatureRetiree(evenement: EvenementCandidature): void {
  // Fire-and-forget : jamais d'exception, jamais de verdict touché.
  void notifierCandidatureRetiree(evenement)
}

/** M9 BRANCHÉ : le candidat est prévenu du changement de statut. */
export function statutChange(evenement: EvenementStatutChange): void {
  // Fire-and-forget : jamais d'exception, jamais de verdict touché.
  void notifierStatutChange(evenement)
}
