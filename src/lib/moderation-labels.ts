// ─── Vocabulaire de modération (M10) ─────────────────────────────────────────
//
// Module PUR, importable côté client comme côté serveur : pages, actions et
// exports lisent ICI les décisions et les motifs. Aucun texte n'est recopié
// dans un écran. Les codes sont fermés et bornés à 50 caractères (colonne
// `motif` / `motif_decision` du schéma) : une valeur hors catalogue ne peut
// pas être affichée comme un libellé métier.
// ---------------------------------------------------------------------------

export const STATUTS_SIGNALEMENT = ['ouvert', 'traite'] as const
export type StatutSignalement = (typeof STATUTS_SIGNALEMENT)[number]

export const LIBELLES_STATUT_SIGNALEMENT: Record<StatutSignalement, string> = {
  ouvert: 'Ouvert',
  traite: 'Traité',
}

export const DECISIONS_SIGNALEMENT = [
  'sans_suite',
  'avertissement',
  'masquage',
  'suspension',
] as const
export type DecisionSignalement = (typeof DECISIONS_SIGNALEMENT)[number]

export const LIBELLES_DECISION: Record<DecisionSignalement, string> = {
  sans_suite: 'Sans suite',
  avertissement: 'Avertissement',
  masquage: 'Masquage du message',
  suspension: 'Suspension du compte',
}

export const DESCRIPTIONS_DECISION: Record<DecisionSignalement, string> = {
  sans_suite: 'Le signalement est clos sans effet sur le message ni sur le compte.',
  avertissement: 'Le signalement est clos avec un avertissement interne.',
  masquage: 'Le message signalé est masqué pour les participants.',
  suspension:
    'Le compte émetteur est suspendu et le message signalé est masqué. Les offres du compte sont retirées de la publication.',
}

/**
 * Effet de masquage d'une décision. `suspension` implique le masquage du
 * message signalé (décision de l'étape 2) ; `masquage` aussi. Source unique
 * utilisée par l'action et par l'écran de confirmation.
 */
export function decisionMasqueMessage(decision: DecisionSignalement): boolean {
  return decision === 'masquage' || decision === 'suspension'
}

export function decisionSuspendCompte(decision: DecisionSignalement): boolean {
  return decision === 'suspension'
}

/** Libellé d'une décision stockée ; `null` = signalement historique. */
export function libelleDecision(decision: string | null | undefined): string {
  if (decision === null || decision === undefined) return 'Décision non renseignée'
  return Object.prototype.hasOwnProperty.call(LIBELLES_DECISION, decision)
    ? LIBELLES_DECISION[decision as DecisionSignalement]
    : 'Décision inconnue'
}

export function estDecisionSignalement(
  valeur: string | null | undefined,
): valeur is DecisionSignalement {
  return (
    valeur !== null &&
    valeur !== undefined &&
    Object.prototype.hasOwnProperty.call(LIBELLES_DECISION, valeur)
  )
}

// ─── Motifs fermés ────────────────────────────────────────────────────────────
//
// Un motif est OBLIGATOIRE pour toute décision, suspension ou consultation
// privée. Les listes sont distinctes par contexte ; quelques codes communs
// (`securite`, `fraude`, `autre`) partagent volontairement le même libellé.

export const MOTIFS_DECISION_SIGNALEMENT = [
  'contenu_illicite',
  'harcelement',
  'propos_haineux',
  'spam',
  'usurpation',
  'autre',
] as const
export type MotifDecisionSignalement = (typeof MOTIFS_DECISION_SIGNALEMENT)[number]

export const MOTIFS_SUSPENSION_UTILISATEUR = [
  'securite',
  'fraude',
  'comportement',
  'demande_utilisateur',
  'autre',
] as const
export type MotifSuspensionUtilisateur = (typeof MOTIFS_SUSPENSION_UTILISATEUR)[number]

export const MOTIFS_SUSPENSION_OFFRE = [
  'qualite',
  'fraude',
  'securite',
  'signalement',
  'autre',
] as const
export type MotifSuspensionOffre = (typeof MOTIFS_SUSPENSION_OFFRE)[number]

export const MOTIFS_ACCES_CONVERSATION = [
  'enquete',
  'verification_contexte',
  'recours',
  'autre',
] as const
export type MotifAccesConversation = (typeof MOTIFS_ACCES_CONVERSATION)[number]

export const MOTIFS_RETABLISSEMENT = [
  'erreur_moderation',
  'recours_fonde',
  'decision_annulee',
  'autre',
] as const
export type MotifRetablissement = (typeof MOTIFS_RETABLISSEMENT)[number]

export const MOTIFS_AUDIT = [
  ...MOTIFS_DECISION_SIGNALEMENT,
  ...MOTIFS_SUSPENSION_UTILISATEUR,
  ...MOTIFS_SUSPENSION_OFFRE,
  ...MOTIFS_ACCES_CONVERSATION,
  ...MOTIFS_RETABLISSEMENT,
] as const
export type MotifAudit = (typeof MOTIFS_AUDIT)[number]

export const LIBELLES_MOTIF: Record<MotifAudit, string> = {
  contenu_illicite: 'Contenu illicite',
  harcelement: 'Harcèlement',
  propos_haineux: 'Propos haineux',
  spam: 'Spam',
  usurpation: "Usurpation d'identité",
  securite: 'Sécurité',
  fraude: 'Fraude',
  comportement: 'Comportement',
  demande_utilisateur: "Demande de l'utilisateur",
  qualite: "Qualité de l'offre",
  signalement: 'Signalement',
  enquete: 'Enquête',
  verification_contexte: 'Vérification du contexte',
  recours: 'Recours',
  erreur_moderation: 'Erreur de modération',
  recours_fonde: 'Recours fondé',
  decision_annulee: 'Décision annulée',
  autre: 'Autre',
}

export function libelleMotif(motif: string | null | undefined): string {
  if (motif === null || motif === undefined) return 'Motif non renseigné'
  return Object.prototype.hasOwnProperty.call(LIBELLES_MOTIF, motif)
    ? LIBELLES_MOTIF[motif as MotifAudit]
    : 'Motif inconnu'
}

export function estMotifAudit(valeur: string | null | undefined): valeur is MotifAudit {
  return (
    valeur !== null &&
    valeur !== undefined &&
    Object.prototype.hasOwnProperty.call(LIBELLES_MOTIF, valeur)
  )
}

export const OPTIONS_MOTIF_DECISION_SIGNALEMENT = MOTIFS_DECISION_SIGNALEMENT.map(
  (valeur) => ({ valeur, libelle: LIBELLES_MOTIF[valeur] }),
)

export const OPTIONS_MOTIF_SUSPENSION_UTILISATEUR = MOTIFS_SUSPENSION_UTILISATEUR.map(
  (valeur) => ({ valeur, libelle: LIBELLES_MOTIF[valeur] }),
)

export const OPTIONS_MOTIF_SUSPENSION_OFFRE = MOTIFS_SUSPENSION_OFFRE.map((valeur) => ({
  valeur,
  libelle: LIBELLES_MOTIF[valeur],
}))

export const OPTIONS_MOTIF_ACCES_CONVERSATION = MOTIFS_ACCES_CONVERSATION.map(
  (valeur) => ({ valeur, libelle: LIBELLES_MOTIF[valeur] }),
)

export const OPTIONS_MOTIF_RETABLISSEMENT = MOTIFS_RETABLISSEMENT.map((valeur) => ({
  valeur,
  libelle: LIBELLES_MOTIF[valeur],
}))
