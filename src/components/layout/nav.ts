import type { Role } from '@/lib/definitions'

// ─── Navigation par rôle ─────────────────────────────────────────────────────
// Source : sidebars legacy (layouts/partiel/sidebar-*.blade.php) et routes
// legacy (routes/web.php). Chaque lien correspond à une route réelle du
// plan de migration — les pages non encore migrées répondent 404 jusqu'à
// leur module, mais l'arborescence est celle de la cible.
//
// Deux niveaux :
// - NAV_PRIMARY   : barre du header (desktop), cœur du parcours, 4 items max
//                   pour tenir à partir de 1024px ;
// - NAV_SECONDARY : menu profil (desktop) + menu mobile. Avec PRIMARY, la
//                   navigation complète reste atteignable partout.
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string
  href: string
}

/** Navigation publique (visiteur non connecté). */
export const PUBLIC_NAV: NavItem[] = [
  { label: "Offres d'emploi", href: '/offres' },
  // Catégories et « Comment ça marche » rejoindront cette liste avec la
  // page d'accueil (ancres legacy #categories / #comment).
]

export const NAV_PRIMARY: Record<Role, NavItem[]> = {
  candidat: [
    { label: 'Tableau de bord', href: '/candidat/dashboard' },
    { label: "Offres d'emploi", href: '/offres' },
    { label: 'Mes candidatures', href: '/candidat/candidatures' },
    { label: 'Messages', href: '/messages' },
  ],
  recruteur: [
    { label: 'Tableau de bord', href: '/recruteur/dashboard' },
    { label: 'Mes offres', href: '/recruteur/offres' },
    { label: 'Candidatures reçues', href: '/recruteur/candidatures' },
    { label: 'Recherche candidats', href: '/recruteur/candidats' },
  ],
  admin: [
    { label: 'Tableau de bord', href: '/admin/dashboard' },
    { label: 'Utilisateurs', href: '/admin/utilisateurs' },
    { label: "Offres d'emploi", href: '/admin/offres' },
    { label: 'Entreprises', href: '/admin/entreprises' },
  ],
}

export const NAV_SECONDARY: Record<Role, NavItem[]> = {
  candidat: [
    { label: 'Mon profil', href: '/candidat/profil' },
    { label: 'Offres sauvegardées', href: '/candidat/offres/sauvegardees' },
    { label: 'Notifications', href: '/notifications' },
    { label: 'Paramètres', href: '/parametres' },
  ],
  recruteur: [
    { label: 'Mon entreprise', href: '/recruteur/entreprise' },
    { label: 'Messages', href: '/messages' },
    { label: 'Notifications', href: '/notifications' },
    { label: 'Paramètres', href: '/parametres' },
  ],
  admin: [
    { label: 'Catégories', href: '/admin/categories' },
    { label: 'Statistiques', href: '/admin/statistiques' },
    { label: 'Notifications', href: '/notifications' },
    { label: 'Paramètres', href: '/parametres' },
  ],
}

/** Libellé d'affichage d'un rôle (badge, menu profil). */
export const ROLE_LABEL: Record<Role, string> = {
  candidat: 'Candidat',
  recruteur: 'Recruteur',
  admin: 'Administrateur',
}
