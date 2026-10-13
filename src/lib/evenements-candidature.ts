import type { StatutCandidature } from '@prisma/client'

import { conversationCreee } from '@/lib/evenements-messagerie'
import { creerConversationDepuisCandidature } from '@/lib/messagerie-creation'

// ─── Hooks d'événements de candidature (M7) — POINT DE BRANCHEMENT M8 / M9 ───
//
// Les modules futurs s'installent ICI, jamais dans les actions :
//  * M8 (BRANCHÉ, Vague 2) : création de la conversation-cadre à l'envoi →
//    dans `candidatureEnvoyee` ;
//  * M9 : notification au candidat d'un changement de statut → branchement
//    dans `statutChange` (et, si M9 le décide, `candidatureRetiree`).
//
// Contrats de ce module, à respecter même après branchement :
//  * AUCUN import Prisma DIRECT (uniquement les `type` ci-dessous) — le
//    branchement M8 passe par `messagerie-creation`, lib serveur
//    propriétaire de sa propre connexion ; aucun 'use server' ici : ce ne
//    sont pas des actions, ce sont des points d'extension appelés PAR les
//    actions ;
//  * JAMAIS d'exception, JAMAIS de log, toujours `void` : les actions M7 ne
//    peuvent pas voir leur verdict modifié par un événement — les chemins
//    d'échec des branches sont avalés sur place (cf. `candidatureEnvoyee`) ;
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

/** M8 BRANCHÉ (Vague 2) : la conversation-cadre naît avec l'envoi. */
export function candidatureEnvoyee(evenement: EvenementCandidature): void {
  // UNE conversation par candidature, créée AU MOMENT où la candidature
  // devient visible : les deux parties écrivent sans aucune action
  // d'ouverture (Étape 2 validée). Fire-and-forget au sens strict du
  // contrat : jamais d'exception, jamais de log — un raté de base au pire
  // moment (entre l'écriture de la candidature et celle de la
  // conversation) laisse la conversation absente, écart assumé et
  // documenté plutôt que de risquer un verdict M7 retourné.
  void creerConversationDepuisCandidature(evenement.candidatureId)
    .then((conversationId) => {
      // Événement M9 (no-op aujourd'hui) : une SEULE fois par conversation
      // créée — le chemin P2002 (course, déjà créée) ne le déclenche pas.
      if (conversationId !== null) {
        conversationCreee({ conversationId, candidatureId: evenement.candidatureId })
      }
    })
    .catch(() => {
      // Échec DB absorbé : contrat no-throw/no-log du module. Voir plus
      // haut l'écart assumé — aucune décision utilisateur n'en dépend.
    })
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
