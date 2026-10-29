// ─── Catalogue d'affichage du journal d'audit (M10) ──────────────────────────
//
// Module PUR : la page admin et l'export CSV importent ces libellés, jamais
// une chaîne recopiée. Les actions écrites par M10 sont limitées à
// ACTIONS_AUDIT_GENERIQUES (la fonction d'écriture n'accepte que ce type) ;
// ACTIONS_AUDIT couvre en plus les actions historiques M7/M8 lues via la vue.
// ---------------------------------------------------------------------------

/** Acteur conventionnel des actions CLI sans session admin (jamais un user id). */
export const ACTEUR_AUDIT_SYSTEME = 0

export const SOURCES_AUDIT = [
  'generique',
  'candidatures',
  'conversations',
  'fichiers',
] as const
export type SourceAudit = (typeof SOURCES_AUDIT)[number]

export const LIBELLES_SOURCE_AUDIT: Record<SourceAudit, string> = {
  generique: 'Journal générique',
  candidatures: 'Candidatures',
  conversations: 'Conversations',
  fichiers: 'Fichiers',
}

export const ACTIONS_AUDIT = [
  // Actions historiques lues dans la vue (M7/M8).
  'creation',
  'retrait',
  'transition',
  'consultation',
  'consultation_conversation',
  'consultation_fichier',
  // Actions M10 écrites dans JournalAudit.
  'connexion_admin',
  'activation_admin',
  'invitation_admin',
  'reprise_admin',
  'reauthentification_admin',
  'suspension_utilisateur',
  'reactivation_utilisateur',
  'suspension_offre',
  'reactivation_offre',
  'decision_signalement',
  'masquage_message',
  'retablissement_message',
  'export_audit',
  'anonymisation_utilisateur',
] as const
export type ActionAudit = (typeof ACTIONS_AUDIT)[number]

export const ACTIONS_AUDIT_GENERIQUES = [
  'connexion_admin',
  'activation_admin',
  'invitation_admin',
  'reprise_admin',
  'reauthentification_admin',
  'suspension_utilisateur',
  'reactivation_utilisateur',
  'suspension_offre',
  'reactivation_offre',
  'decision_signalement',
  'masquage_message',
  'retablissement_message',
  'consultation_conversation',
  'export_audit',
  'anonymisation_utilisateur',
] as const
export type ActionAuditGenerique = (typeof ACTIONS_AUDIT_GENERIQUES)[number]

export const LIBELLES_ACTION_AUDIT: Record<ActionAudit, string> = {
  creation: 'Création de candidature',
  retrait: 'Retrait de candidature',
  transition: 'Changement de statut de candidature',
  consultation: "Consultation d'une candidature",
  consultation_conversation: "Consultation d'une conversation depuis un signalement",
  consultation_fichier: "Consultation d'un fichier",
  connexion_admin: 'Connexion administrateur',
  activation_admin: "Activation d'un compte administrateur",
  invitation_admin: "Invitation d'un compte administrateur",
  reprise_admin: "Reprise d'un compte administrateur existant",
  reauthentification_admin: 'Réauthentification administrateur',
  suspension_utilisateur: "Suspension d'un compte utilisateur",
  reactivation_utilisateur: "Réactivation d'un compte utilisateur",
  suspension_offre: "Suspension d'une offre",
  reactivation_offre: "Réactivation d'une offre",
  decision_signalement: "Décision sur un signalement",
  masquage_message: "Masquage d'un message",
  retablissement_message: "Rétablissement d'un message",
  export_audit: "Export du journal d'audit",
  anonymisation_utilisateur: "Anonymisation d'un compte utilisateur",
}

export const CIBLES_AUDIT = [
  'utilisateur',
  'admin',
  'offre',
  'signalement',
  'message',
  'conversation',
  'candidature',
  'candidat',
  'systeme',
] as const
export type CibleAudit = (typeof CIBLES_AUDIT)[number]

export const CIBLES_AUDIT_GENERIQUES = [
  'utilisateur',
  'admin',
  'offre',
  'signalement',
  'message',
  'conversation',
  'systeme',
] as const
export type CibleAuditGenerique = (typeof CIBLES_AUDIT_GENERIQUES)[number]

export const LIBELLES_CIBLE_AUDIT: Record<CibleAudit, string> = {
  utilisateur: 'Utilisateur',
  admin: 'Administrateur',
  offre: 'Offre',
  signalement: 'Signalement',
  message: 'Message',
  conversation: 'Conversation',
  candidature: 'Candidature',
  candidat: 'Candidat',
  systeme: 'Système',
}

export function libelleSourceAudit(source: string): string {
  return Object.prototype.hasOwnProperty.call(LIBELLES_SOURCE_AUDIT, source)
    ? LIBELLES_SOURCE_AUDIT[source as SourceAudit]
    : 'Source inconnue'
}

export function libelleActionAudit(action: string): string {
  return Object.prototype.hasOwnProperty.call(LIBELLES_ACTION_AUDIT, action)
    ? LIBELLES_ACTION_AUDIT[action as ActionAudit]
    : 'Action inconnue'
}

export function libelleCibleAudit(cible: string): string {
  return Object.prototype.hasOwnProperty.call(LIBELLES_CIBLE_AUDIT, cible)
    ? LIBELLES_CIBLE_AUDIT[cible as CibleAudit]
    : 'Cible inconnue'
}

export function estSourceAudit(valeur: string | null | undefined): valeur is SourceAudit {
  return (
    valeur !== null &&
    valeur !== undefined &&
    Object.prototype.hasOwnProperty.call(LIBELLES_SOURCE_AUDIT, valeur)
  )
}

export function estActionAudit(valeur: string | null | undefined): valeur is ActionAudit {
  return (
    valeur !== null &&
    valeur !== undefined &&
    Object.prototype.hasOwnProperty.call(LIBELLES_ACTION_AUDIT, valeur)
  )
}

export function estActionAuditGenerique(
  valeur: string | null | undefined,
): valeur is ActionAuditGenerique {
  return (
    valeur !== null &&
    valeur !== undefined &&
    (ACTIONS_AUDIT_GENERIQUES as readonly string[]).includes(valeur)
  )
}

export function estCibleAudit(valeur: string | null | undefined): valeur is CibleAudit {
  return (
    valeur !== null &&
    valeur !== undefined &&
    Object.prototype.hasOwnProperty.call(LIBELLES_CIBLE_AUDIT, valeur)
  )
}

export function estCibleAuditGenerique(
  valeur: string | null | undefined,
): valeur is CibleAuditGenerique {
  return (
    valeur !== null &&
    valeur !== undefined &&
    (CIBLES_AUDIT_GENERIQUES as readonly string[]).includes(valeur)
  )
}
