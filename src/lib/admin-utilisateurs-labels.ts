import type { Role } from '@/lib/definitions'

// ─── Libellés de la gestion des utilisateurs (M10) ──────────────────────────
// Module pur : la liste, le détail et les formulaires lisent ICI. Aucun
// libellé métier n'est recopié dans une page, aucun texte d'URL n'est affiché.
// ---------------------------------------------------------------------------

export const LIBELLES_ROLE_UTILISATEUR: Record<Role, string> = {
  candidat: 'Candidat',
  recruteur: 'Recruteur',
  admin: 'Administrateur',
}

export type StatutCompte = 'actif' | 'suspendu'

export const LIBELLES_STATUT_COMPTE: Record<StatutCompte, string> = {
  actif: 'Actif',
  suspendu: 'Suspendu',
}

export const TEXTES_ADMIN_UTILISATEURS = {
  titreListe: 'Utilisateurs',
  descriptionListe:
    'Comptes candidats, recruteurs et administrateurs. Les comptes administrateurs sont en lecture seule.',
  titreDetail: "Détail de l'utilisateur",
  recherche: 'Rechercher un nom ou un email',
  filtreRole: 'Rôle',
  filtreStatut: 'Statut du compte',
  tousLesRoles: 'Tous les rôles',
  tousLesStatuts: 'Tous les statuts',
  listeVide: 'Aucun utilisateur ne correspond aux filtres.',
  pagination: 'Pagination des utilisateurs',
  email: 'Email',
  telephone: 'Téléphone',
  ville: 'Ville',
  pays: 'Pays',
  creeLe: 'Compte créé le',
  activite: 'Activité',
  candidatures: 'Candidatures',
  offres: 'Offres publiées',
  compteAdmin:
    'Ce compte administrateur est en lecture seule : aucune suspension ni modification ne peut être effectuée depuis cette interface.',
  compteAnonymise:
    'Ce compte a été anonymisé. Il ne peut plus être suspendu ni réactivé.',
  suspendre: 'Suspendre le compte',
  reactiver: 'Réactiver le compte',
  motifSuspension: 'Motif de la suspension',
  motifReactivation: 'Motif de la réactivation',
  noteInterne: 'Note interne (facultatif)',
  noteInterneAide:
    'Cette note est conservée dans le journal d’audit et n’est jamais affichée aux utilisateurs.',
  suspendu: 'Compte suspendu. La session en cours est invalidée immédiatement.',
  reactive: 'Compte réactivé.',
  erreurForme: 'Le formulaire est incomplet ou invalide.',
  erreurAdmin: 'Un compte administrateur ne peut pas être suspendu.',
  erreurAnonymise: 'Un compte anonymisé ne peut pas être modifié.',
  erreurDejaSuspendu: 'Ce compte est déjà suspendu.',
  erreurDejaActif: 'Ce compte est déjà actif.',
  erreurStatut: 'Le statut du compte a changé entre-temps. Rechargez la page.',
  erreurInconnue: 'La mise à jour du compte a échoué.',
  retourListe: 'Retour à la liste',
} as const
