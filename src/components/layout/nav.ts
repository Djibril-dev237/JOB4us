import type { Role } from '@/lib/definitions'

// ─── Navigation par rôle ─────────────────────────────────────────────────────
// Source : sidebars legacy (layouts/partiel/sidebar-*.blade.php) et routes
// legacy (routes/web.php). Chaque lien correspond à une route réelle du
// plan de migration — les pages non encore migrées répondent 404 jusqu'à
// leur module, mais l'arborescence est celle de la cible.
//
// Trois jeux :
// - PUBLIC_NAV    : visiteur, liens centrés du header + section sans titre
//                   du tiroir mobile ;
// - SIDEBAR_NAV   : shell connecté — sidebar desktop 264px ET tiroir mobile,
//                   sections identiques aux sidebars PHP ;
// - NAV_SECONDARY : menu profil desktop (AvatarMenu).
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

// ─── Sidebar (shell connecté) ────────────────────────────────────────────────
// Sections et ordre repris à l'identique des sidebars legacy
// (layouts/partiel/sidebar-{candidat,recruteur,admin}.blade.php) : la sidebar
// porte TOUTE la navigation de l'espace, le header n'affiche plus que la
// recherche, la cloche et le menu profil.

export interface SidebarSection {
  title: string
  items: NavItem[]
}

export const SIDEBAR_NAV: Record<Role, SidebarSection[]> = {
  candidat: [
    {
      title: 'Principal',
      items: [
        { label: 'Tableau de bord', href: '/candidat/dashboard' },
        { label: 'Mon profil', href: '/candidat/profil' },
        { label: 'Mes candidatures', href: '/candidat/candidatures' },
        { label: 'Offres sauvegardées', href: '/candidat/offres/sauvegardees' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { label: 'Messages', href: '/messages' },
        { label: 'Notifications', href: '/notifications' },
      ],
    },
    {
      title: 'Explorer',
      items: [{ label: "Offres d'emploi", href: '/offres' }],
    },
    {
      title: 'Compte',
      items: [{ label: 'Paramètres', href: '/parametres' }],
    },
  ],
  recruteur: [
    {
      title: 'Principal',
      items: [
        { label: 'Tableau de bord', href: '/recruteur/dashboard' },
        { label: 'Mon entreprise', href: '/recruteur/entreprise' },
      ],
    },
    {
      title: 'Recrutement',
      items: [
        { label: 'Mes offres', href: '/recruteur/offres' },
        { label: 'Candidatures reçues', href: '/recruteur/candidatures' },
        { label: 'Recherche candidats', href: '/recruteur/candidats' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { label: 'Messages', href: '/messages' },
        { label: 'Notifications', href: '/notifications' },
      ],
    },
    {
      title: 'Compte',
      items: [{ label: 'Paramètres', href: '/parametres' }],
    },
  ],
  admin: [
    {
      title: 'Principal',
      items: [{ label: 'Tableau de bord', href: '/admin/dashboard' }],
    },
    {
      title: 'Gestion',
      items: [
        { label: 'Utilisateurs', href: '/admin/utilisateurs' },
        { label: "Offres d'emploi", href: '/admin/offres' },
        { label: 'Entreprises', href: '/admin/entreprises' },
        { label: 'Catégories', href: '/admin/categories' },
        { label: 'Statistiques', href: '/admin/statistiques' },
      ],
    },
    {
      title: 'Communication',
      items: [{ label: 'Notifications', href: '/notifications' }],
    },
    {
      title: 'Compte',
      items: [{ label: 'Paramètres', href: '/parametres' }],
    },
  ],
}

/** Libellé d'affichage d'un rôle (badge, menu profil). */
export const ROLE_LABEL: Record<Role, string> = {
  candidat: 'Candidat',
  recruteur: 'Recruteur',
  admin: 'Administrateur',
}

/** Le chemin correspond-il au lien ? (exact, ou sous-chemin pour un préfixe) */
export function isActiveLink(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
