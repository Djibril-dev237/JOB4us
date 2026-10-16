// ─── Textes et catalogue des notifications (M9) ──────────────────────────────
//
// Contrat INTER-SA (calque exact de src/lib/messagerie-labels.ts, motif de
// src/lib/offres-labels.ts) : les vagues/SA suivantes importent ICI leurs
// textes, leur catalogue de types et leurs valeurs par défaut — jamais un
// texte n'est écrit deux fois, jamais un email n'invente une phrase (faille
// anti-vibecoding).
//
// Décisions qui se matérialisent ici (Étapes 2 et 4 validées) :
//  * le CATALOGUE est une liste fermée de 8 types : toute notification
//    appartient à `TypeNotification`, le schema Prisma (Vague 1) en reprend
//    les valeurs telles quelles — aucun type libre, aucune inscription
//    hors catalogue ;
//  * chaque type porte ses métadonnées en UN SEUL endroit : libellé,
//    description de préférence, défaut email, désactivabilité. Les pages,
//    l'émission et les emails lisent ce tableau, jamais l'inverse ;
//  * `texteNotification` est la SEULE fabrique de titre/contenu : ses
//    variables sont une union discriminée FERMÉE (titre d'offre, libellé de
//    statut, acteur, compteur) — la règle de confidentialité (aucun texte
//    de message, aucune coordonnée, aucun lien de fichier) est structurelle,
//    pas seulement morale : un champ hors liste ne peut pas entrer ;
//  * les défauts de préférence vivent dans `preferencesParDefaut` (code,
//    jamais de seed) : l'absence de ligne en base vaut la valeur du code.
//
// Aucune donnée n'est affichée depuis ce module : les variables reçues
// ({titreOffre}, {acteur}…) sont recopiées TELLES QUELLES dans les chaînes.
// L'échappement appartient au rendu (React échappe ; le module email
// échappera en HTML) — ce module n'est pas un point d'échappement.
// ---------------------------------------------------------------------------

/**
 * Catalogue fermé des notifications (source de vérité du module).
 * L'enum Prisma `TypeNotification` (Vague 1) reprend ces valeurs.
 */
export const TYPE_NOTIFICATIONS = [
  'candidatureRecue',
  'statutCandidature',
  'candidatureRetiree',
  'nouveauMessage',
  'offreIndisponible',
  'signalementRecu',
  'offrePubliee',
  'entrepriseCertifiee',
] as const

export type TypeNotification = (typeof TYPE_NOTIFICATIONS)[number]

/** Métadonnées d'un type : tout ce que les écrans et l'émission doivent savoir. */
export interface MetadonneesType {
  /** Libellé (liste de préférences, libellé de regroupement). */
  libelle: string
  /** Description en une phrase, affichée sous le libellé des préférences. */
  description: string
  /** Canal email activé par défaut (Étape 2 : ON pour les 6 de base). */
  emailParDefaut: boolean
  /** L'utilisateur peut-il désactiver ce type (seul `signalementRecu` : non). */
  desactivable: boolean
}

/**
 * Table unique des métadonnées. Les 6 types de base partent par email par
 * défaut (validé Étape 3) ; les 2 repris du legacy secondaire sont in-app
 * seulement ; `signalementRecu` ne se désactive jamais (devoir de
 * modération, volume faible et constant).
 */
export const METADONNEES: Record<TypeNotification, MetadonneesType> = {
  candidatureRecue: {
    libelle: 'Nouvelle candidature',
    description: 'Recevoir un email quand un candidat postule à votre offre.',
    emailParDefaut: true,
    desactivable: true,
  },
  statutCandidature: {
    libelle: 'Statut de candidature',
    description: 'Recevoir un email quand le statut de votre candidature change.',
    emailParDefaut: true,
    desactivable: true,
  },
  candidatureRetiree: {
    libelle: 'Candidature retirée',
    description: 'Recevoir un email quand un candidat retire sa candidature.',
    emailParDefaut: true,
    desactivable: true,
  },
  nouveauMessage: {
    libelle: 'Nouveau message',
    description: 'Recevoir un email quand un interlocuteur vous écrit.',
    emailParDefaut: true,
    desactivable: true,
  },
  offreIndisponible: {
    libelle: 'Offre retirée',
    description: 'Recevoir un email quand une offre à laquelle vous avez postulé n’est plus disponible.',
    emailParDefaut: true,
    desactivable: true,
  },
  signalementRecu: {
    libelle: 'Signalement reçu',
    description: 'Les alertes de modération ne se désactivent pas.',
    emailParDefaut: true,
    desactivable: false,
  },
  offrePubliee: {
    libelle: 'Nouvelle offre publiée',
    description: 'Voir les nouvelles offres publiées sur la plateforme.',
    emailParDefaut: false,
    desactivable: true,
  },
  entrepriseCertifiee: {
    libelle: 'Entreprise certifiée',
    description: 'Voir les certifications d’entreprise.',
    emailParDefaut: false,
    desactivable: true,
  },
}

/** Types que l'utilisateur ne peut JAMAIS désactiver (dérivé, jamais recopié). */
export const TYPES_NON_DESACTIVABLES = TYPE_NOTIFICATIONS.filter(
  (type) => !METADONNEES[type].desactivable,
)

/**
 * Préférences par défaut, dérivées du tableau : une ligne absente de la
 * table `NotificationPreference` vaut exactement cette valeur (pas de seed).
 */
export function preferencesParDefaut(): Record<TypeNotification, boolean> {
  const defauts = {} as Record<TypeNotification, boolean>
  for (const type of TYPE_NOTIFICATIONS) {
    defauts[type] = METADONNEES[type].emailParDefaut
  }
  return defauts
}

// ─── Fabrique de titre/contenu (variables fermées) ───────────────────────────
//
// Union discriminée : chaque type n'accepte QUE ses variables. Aucun champ
// de texte libre de la base n'entre ici sans passer par cette liste — la
// moindre variable supplémentaire casse le typage au build, pas le silence.

export interface VariablesCandidatureRecue {
  titreOffre: string
}
export interface VariablesStatutCandidature {
  titreOffre: string
  libelleStatut: string
}
export interface VariablesCandidatureRetiree {
  titreOffre: string
}
export interface VariablesNouveauMessage {
  /** Prénom et nom de l'interlocuteur connu (pas un champ libre). */
  acteur: string
  /** Nombre de messages du regroupement (entier issu du compteur). */
  compteur: number
}
export interface VariablesOffreIndisponible {
  titreOffre: string
}
export interface VariablesOffrePubliee {
  titreOffre: string
}
export interface VariablesEntrepriseCertifiee {
  nomEntreprise: string
}

export type VariablesNotification =
  | ({ type: 'candidatureRecue' } & VariablesCandidatureRecue)
  | ({ type: 'statutCandidature' } & VariablesStatutCandidature)
  | ({ type: 'candidatureRetiree' } & VariablesCandidatureRetiree)
  | ({ type: 'nouveauMessage' } & VariablesNouveauMessage)
  | ({ type: 'offreIndisponible' } & VariablesOffreIndisponible)
  // Aucune variable : le minimum absolu, jamais de détail du signalement.
  | { type: 'signalementRecu' }
  | ({ type: 'offrePubliee' } & VariablesOffrePubliee)
  | ({ type: 'entrepriseCertifiee' } & VariablesEntrepriseCertifiee)

/** Titre et contenu in-app d'une notification, du catalogue uniquement. */
export function texteNotification(
  variables: VariablesNotification,
): { titre: string; contenu: string } {
  switch (variables.type) {
    case 'candidatureRecue':
      return {
        titre: 'Nouvelle candidature',
        contenu: `Un candidat a postulé à votre offre « ${variables.titreOffre} ».`,
      }
    case 'statutCandidature':
      return {
        titre: 'Statut de candidature',
        contenu: `Le statut de votre candidature à « ${variables.titreOffre} » est passé à ${variables.libelleStatut}.`,
      }
    case 'candidatureRetiree':
      return {
        titre: 'Candidature retirée',
        contenu: `Un candidat a retiré sa candidature à « ${variables.titreOffre} ».`,
      }
    case 'nouveauMessage':
      return {
        titre: `Nouveau message de ${variables.acteur}`,
        contenu: `${variables.acteur} vous a envoyé un message.`,
      }
    case 'offreIndisponible':
      return {
        titre: 'Offre retirée',
        contenu: `L’offre « ${variables.titreOffre} » n’est plus disponible.`,
      }
    case 'signalementRecu':
      return {
        titre: 'Signalement reçu',
        contenu: 'Un nouveau signalement attend d’être examiné.',
      }
    case 'offrePubliee':
      return {
        titre: 'Nouvelle offre publiée',
        contenu: `Une nouvelle offre a été publiée : « ${variables.titreOffre} ».`,
      }
    case 'entrepriseCertifiee':
      return {
        titre: 'Entreprise certifiée',
        contenu: `L’entreprise « ${variables.nomEntreprise} » a été certifiée.`,
      }
  }
}

/**
 * Libellé de regroupement des messages d'une conversation : une SEULE
 * notification porte un compteur, lisible en un coup d'œil.
 */
export function texteGroupeMessages(compteur: number): string {
  return compteur > 1 ? `${compteur} nouveaux messages` : 'Nouveau message'
}

// ─── Textes des écrans et des emails (source unique) ─────────────────────────
//
// Aucun texte n'est inventé ici : les phrases de l'Étape 4 validée sont la
// source (règle anti-vibecoding), apostrophes et espacement de ponctuation
// compris. Aucun tiret cadratin, aucune mention d'outil.

export const TEXTES = {
  // Page /notifications (liste).
  titreNotifications: 'Notifications',
  boutonToutLire: 'Tout marquer comme lu',
  boutonMarquerLu: 'Marquer comme lu',
  boutonSupprimer: 'Supprimer',
  confirmationSuppression: 'Supprimer cette notification ?',
  notificationSupprimee: 'Notification supprimée.',
  marqueesLues: 'Notifications marquées comme lues.',
  chargerPlus: 'Charger plus de notifications',
  pagination: 'Pagination des notifications',
  listeVide: 'Aucune notification pour le moment.',
  lienListeVide: 'Parcourir les offres',
  erreurChargement: 'Impossible de charger vos notifications.',
  boutonReessayer: 'Réessayer',
  actionEchouee: 'Action impossible. Réessayez.',
  /** Annonce du lecteur d'écran pour le badge de non-lues du header. */
  nonLue: 'non lue',
  nonLues: 'non lues',
  /** Marqueur sr-only d'une carte non lue (le visuel porte la barre). */
  statutNonLue: 'Non lue',

  // Page /notifications/preferences.
  titrePreferences: 'Préférences de notification',
  introPreferences:
    'Choisissez les emails que vous recevez. Les notifications dans l’application sont toujours actives.',
  sectionEmails: 'Par email',
  sectionResumeQuotidien: 'Résumé quotidien',
  descriptionResumeQuotidien:
    'Recevoir une fois par jour un résumé des notifications dont vous n’avez pas eu de nouvelles par email.',
  resumeQuotidien: 'Résumé quotidien',
  canalApplication: 'Notifications dans l’application : toujours actives.',
  badgeToujoursActif: 'Toujours actif',
  interrupteurEmail: 'Recevoir des emails',
  preferencesEnregistrees: 'Préférences enregistrées.',
  preferencesEchouees: 'Préférences non enregistrées. Réessayez.',

  // Page /desabonnement/[jeton].
  titreDesabonnement: 'Désabonnement',
  desabonnementConfirme: 'Vous ne recevrez plus ces emails.',
  lienReactiver: 'Réactiver tous les emails',
  reactivationConfirmee: 'Vos emails sont de nouveau activés.',
  jetonInvalide: 'Ce lien de désabonnement n’est plus valide.',
  explicationJeton:
    'Ce lien est personnel et expire au bout de 7 jours. Il ne donne accès à aucune autre page.',

  // Résumé quotidien (email).
  sujetEmailResume: 'Job4Us : votre résumé du jour',
  corpsEmailResume: 'Voici l’activité de vos notifications depuis hier.',
  resumeAucuneNouveaute: 'Aucune nouvelle notification depuis hier.',

  // Communs aux emails transactionnels (pied de page).
  contexteEmail: 'Vous recevez cet email car des notifications sont actives sur votre compte Job4Us.',
  lienGererPreferences: 'Gérer mes notifications',
  lienDesabonner: 'Se désabonner de ces emails',
} as const
