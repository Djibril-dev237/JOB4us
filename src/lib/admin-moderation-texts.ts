// ─── Textes des écrans de modération admin (M10) ─────────────────────────────
//
// Module PUR, importable côté client comme côté serveur. Les libellés de
// décisions et de motifs vivent dans moderation-labels.ts ; ce module porte
// uniquement les phrases d'interface du détail d'un signalement. Aucun texte
// n'est recopié dans un composant.
// ---------------------------------------------------------------------------

export const TEXTES_MODERATION = {
  accesTitre: 'Accès à la conversation',
  accesExplication:
    'Le contenu de cette conversation est privé. Choisissez un motif et confirmez votre identité pour le consulter.',
  accesMotif: 'Motif de consultation',
  accesOuvrir: 'Ouvrir la conversation',
  accesEchoue: 'Accès impossible. Réessayez.',
  accesInterdit: "Cette consultation n'est pas autorisée.",
  reauthRequise: 'Une réauthentification récente est nécessaire pour cette action.',
  reauthLien: 'Confirmer mon identité',
  contexteTitre: 'Contexte de la conversation',
  contexteVide: 'Aucun message dans la fenêtre de consultation.',
  conversationPrivee: 'Conversation protégée',
  conversationPriveeAide:
    "Le contenu n'est affiché qu'après la procédure d'accès et reste limité à 30 messages.",
  messageSignale: 'Message signalé',
  decisionTitre: 'Décision',
  decisionAide:
    'La décision est définitive et journalisée. Le message lui-même reste immuable.',
  decisionChamp: 'Décision',
  motifChamp: 'Motif',
  noteChamp: 'Note interne (facultatif)',
  decisionValider: 'Enregistrer la décision',
  decisionFaite: 'Décision enregistrée.',
  decisionDeja: 'Ce signalement a déjà été traité.',
  decisionEchouee: 'Décision impossible. Réessayez.',
  decisionInterdite: "Cette décision n'est pas autorisée.",
  retablirTitre: 'Rétablir le message',
  retablirAide:
    'Le rétablissement est journalisé et rend le message visible aux participants.',
  retablirValider: 'Rétablir le message',
  retablissementFait: 'Message rétabli.',
  retablissementDeja: "Ce message n'est pas masqué.",
  retablissementEchoue: 'Rétablissement impossible. Réessayez.',
  traiteTitre: 'Signalement traité',
  traitePar: 'Traité par',
  nonRenseigne: 'Non renseigné',
  nonRenseignee: 'Non renseignée',
} as const
