import type { Role } from '@/lib/definitions'
import { TEXTES } from '@/lib/notifications-labels'

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
  // Ancres legacy de la page d'accueil (accueil.blade.php : #categories,
  // #comment) — jamais « actives » : ce sont des ancres, pas des routes.
  { label: 'Catégories', href: '/#categories' },
  { label: 'Comment ça marche', href: '/#comment' },
]

export const NAV_SECONDARY: Record<Role, NavItem[]> = {
  candidat: [
    { label: 'Mon profil', href: '/candidat/profil' },
    { label: 'Offres sauvegardées', href: '/candidat/offres/sauvegardees' },
    { label: 'Notifications', href: '/notifications' },
    { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
  ],
  recruteur: [
    { label: 'Mon entreprise', href: '/recruteur/entreprise' },
    { label: 'Messages', href: '/messages' },
    { label: 'Notifications', href: '/notifications' },
    { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
  ],
  admin: [
    { label: 'Statistiques', href: '/admin/statistiques' },
    { label: 'Notifications', href: '/notifications' },
    { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
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
      items: [
        { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
      ],
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
        // « Recherche candidats » (annuaire legacy /recruteur/candidats) :
        // RETIRÉ par décision de confidentialité (matrice Étape 2 validée) :
        // aucun annuaire de profils candidats ne sera construit. Un recruteur
        // ne voit un CV que s'il a reçu une candidature sur SES offres
        // (matrice M4) — jamais une base de profils consultable.
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
      items: [
        { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
      ],
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
        { label: 'Statistiques', href: '/admin/statistiques' },
      ],
    },
    {
      title: 'Modération',
      items: [
        // File des signalements ouverts : l'admin n'accède aux conversations
        // QUE depuis un signalement (aucune navigation libre de boîtes).
        { label: 'Signalements', href: '/admin/signalements' },
        { label: "Journal d'audit", href: '/admin/audit' },
      ],
    },
    {
      title: 'Communication',
      items: [{ label: 'Notifications', href: '/notifications' }],
    },
    {
      title: 'Compte',
      items: [
        { label: TEXTES.titrePreferences, href: '/notifications/preferences' },
      ],
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
