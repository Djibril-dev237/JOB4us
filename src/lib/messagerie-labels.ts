import type { StatutCandidature } from '@prisma/client'

import type { BadgeVariant } from '@/components/ui/badge'

// ─── Libellés et dérivés de l'état des conversations (M8) ────────────────────
// Contrat INTER-SA : les vagues/SA suivantes (liste, fil non lu, fil de
// conversation, actions serveur) importent ICI leurs textes et leurs
// dérivés d'état — jamais de texte recopié entre écrans (calque exact de
// src/lib/offres-labels.ts et src/lib/candidatures-labels.ts, motif repris
// de src/lib/definitions.ts : LABELS + VALUES + types seuls, AUCUN import
// RUNTIME de @prisma/client puisque ce module est importé côté client aussi
// bien que côté serveur).
//
// Décisions qui se matérialisent ici :
//  * une conversation « ouvre » ou « ferme » SUIVANT le statut de la
//    candidature qui la a fait naître : les 3 statuts terminaux
//    (acceptee, refusee, retiree) passent la conversation en LECTURE
//    SEULE — plus aucun envoi possible des deux côtés (le retrait retire
//    l'accès au formulaire, pas l'historique : diagnostic #11 de M7) ;
//  * le blocage d'interlocuteur est un SECOND motif de fermeture
//    d'écriture, indépendant du statut : d'où deux fonctions distinctes
//    `motifLectureSeule` (statut de la candidature) et
//    `texteMotifLectureSeule` (bandeau, statut OU blocage) ;
//  * TEXTES est la source UNIQUE des textes visibles en messagerie
//    (bandeaux, états vides, toasts d'erreur, liens contextuels) :
//    faille anti-vibecoding, aucun texte n'est écrit deux fois ;
//  * varianteStatutConversation ne reprend PAS toute la table M7 :
//    seule la FIN de conversation est colorée (acceptee=ok,
//    refusee=danger, retiree=neutral), tout le reste est « ouvert » et
//    s'affiche en brand — la conversation est un flux vivant, pas un
//    parcours de 7 chips.
// ---------------------------------------------------------------------------

/**
 * Les 3 statuts qui figent une conversation en lecture seule.
 * `as const` : le tuple sert de SOURCE à `motifLectureSeule` (une entrée
 * ajoutée ici est aussitôt traitée partout, sans double maintenance).
 */
export const STATUTS_TERMINAIRES = [
  'acceptee',
  'refusee',
  'retiree',
] as const satisfies readonly StatutCandidature[]

/**
 * La conversation est-elle en lecture seule AU MOTIF STATUT ? (le blocage
 * d'interlocuteur est un motif distinct, traité par texteMotifLectureSeule).
 * Dérivée de STATUTS_TERMINAIRES — jamais une liste recopiée.
 */
export function estLectureSeule(statut: StatutCandidature): boolean {
  return motifLectureSeule(statut) !== null
}

/**
 * Quel statut terminal a figé la conversation, ou `null` si elle est
 * encore ouverte. Une seule source (STATUTS_TERMINAIRES) : estLectureSeule,
 * les bandeaux et les boutons d'envoi partagent le même aiguillage.
 */
export function motifLectureSeule(
  statut: StatutCandidature,
): 'acceptee' | 'refusee' | 'retiree' | null {
  // `.find` plutôt qu'une exclusion d'enum : un statut HORS enum (cast,
  // seed raté) ne matche rien → null → conversation réputée ouverte plutôt
  // qu'un TypeError qui transformerait l'affichage en 500.
  return STATUTS_TERMINAIRES.find((terminal) => terminal === statut) ?? null
}

// ─── Textes visibles (source unique) ─────────────────────────────────────────
//
// Aucun texte n'est inventé ici : les valeurs littérales du cahier des
// charges M8 sont la source unique (règle anti-vibecoding), apostrophes et
// espesseurs de ponctuation comprises.

export const TEXTES = {
  /** Bandeau au-dessus du fil quand la candidature est terminale. */
  lectureSeuleAcceptee: 'Cette conversation est en lecture seule : la candidature est acceptée.',
  lectureSeuleRefusee: 'Cette conversation est en lecture seule : la candidature est refusée.',
  lectureSeuleRetiree: 'Cette conversation est en lecture seule : la candidature a été retirée.',
  /** Bandeau quand l'interlocuteur est bloqué (motif ≠ statut). */
  ecritureBloquee: 'Vous ne pouvez plus écrire dans cette conversation.',
  /** États vides de la liste de conversations (général / filtre non lues). */
  listeVide: 'Vos échanges apparaîtront ici après une candidature.',
  listeVideNonLues: 'Aucune conversation non lue.',
  /** État vide d'un fil de conversation ouverte. */
  conversationVide: 'Aucun message pour l’instant.',
  /** Échec de l'envoi (réseau / serveur) — l'utilisateur peut réessayer. */
  envoiEchoue: 'Message non envoyé. Réessayez.',
  /** Envoi REFUSÉ côté serveur (conversation en lecture seule, bloqué). */
  envoiRefuse: 'Envoi refusé.',
  /** Échec de l'actualisation du fil (polling / rafraîchissement). */
  actualisationEchouee: 'Actualisation impossible.',
  /** Toasts de signalement d'un message (modération). */
  signalementEnvoye: 'Signalement transmis.',
  signalementDejaFait: 'Vous avez déjà signalé ce message.',
  /** Toasts d'administration de l'interlocuteur. */
  interlocuteurBloque: 'Interlocuteur bloqué.',
  interlocuteurDebloque: 'Interlocuteur débloqué.',
  /** Avertissement affiché aux modérateurs/admins en consultation. */
  moderationLue: 'Consultation de modération : cette lecture est journalisée.',
  /** Liens contextuels du message vers l'offre et la candidature. */
  lienOffre: 'Voir l’offre',
  lienCandidature: 'Voir la candidature',
  /** Libellés de chargement et d'activité. */
  chargement: 'Chargement…',
  nouveauxMessages: 'Nouveaux messages',

  // Écrans M8 : reprises des vues legacy (messages/index + show.blade.php)
  // et des actions de l'Étape 4 validée — le décompte du titre legacy
  // « {n} conversation(s) » reste littéral, aucune reformulation.
  titreMessages: 'Messages',
  filtreToutes: 'Toutes',
  filtreNonLues: 'Non lues',
  compteurConversations: 'conversation(s)',
  chargerPlus: 'Charger les messages plus anciens',
  envoyer: 'Envoyer',
  placeholderMessage: 'Écrivez votre message...',
  masquer: 'Masquer',
  bloquer: 'Bloquer',
  signaler: 'Signaler',
  fermer: 'Fermer',
  confirmationMasquage: 'Masquer cette conversation ? Elle disparaîtra de votre liste.',
  tropDeMessages: 'Trop de messages envoyés. Patientez une minute.',
} as const

// ─── Variante de badge par état de conversation ──────────────────────────────
//
// Table de décision (contrat M8) : ouverte → brand · acceptee → ok ·
// refusee → danger · retiree → neutral. Seule la fin de la conversation est
// colorée ; « ouverte » regroupe les 4 statuts non terminaux (envoyee,
// consultee, preselectionnee, entretien) — inutile de re-colorier un flux
// qui n'est pas terminé.

export function varianteStatutConversation(statut: StatutCandidature): BadgeVariant {
  const motif = motifLectureSeule(statut)
  if (motif === 'acceptee') return 'ok'
  if (motif === 'refusee') return 'danger'
  if (motif === 'retiree') return 'neutral'
  // Conversation encore ouverte : badge de marque (le seul qui signifie
  // « on peut encore écrire »), jamais `accent` (réservé à la progression
  // M7, cf. candidatures-labels.ts).
  return 'brand'
}

// ─── Bandeau de lecture seule / écriture bloquée ─────────────────────────────
//
// 4 motifs = 4 textes distincts : les 3 terminaux réutilisent la table
// TEXTES (un seul endroit pour ajuster une formulation), le blocage
// d'interlocuteur a SON propre texte (un blocage ne dit rien du statut de
// la candidature).

export function texteMotifLectureSeule(
  motif: 'acceptee' | 'refusee' | 'retiree' | 'bloque',
): string {
  if (motif === 'acceptee') return TEXTES.lectureSeuleAcceptee
  if (motif === 'refusee') return TEXTES.lectureSeuleRefusee
  if (motif === 'retiree') return TEXTES.lectureSeuleRetiree
  return TEXTES.ecritureBloquee
}
