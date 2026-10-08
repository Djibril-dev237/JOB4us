import type { SVGProps } from 'react'

// ─── Icônes locales du dashboard (M6, mission 2B) ────────────────────────────
// Pourquoi un module LOCAL : src/components/icons.tsx appartient au design
// system M2 et ne figure PAS dans la liste de fichiers de la mission 2B —
// il ne peut pas être étendu ici. Crayon (« Modifier ») et poubelle
// (« Supprimer ») sont donc définis à côté de la page, avec le MÊME style
// de trait que le jeu M2 (trait 1.8, extrémités arrondies, currentColor,
// aria-hidden) : visuellement indiscernables d'une icône du jeu partagé.
// Jeu limité aux deux besoins legacy du blade — aucune autre icône
// « inventée » (l'icône briefcase de la carte vient de @/components/icons).
// ---------------------------------------------------------------------------

type IconeProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 16, ...props }: IconeProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/** Crayon d'édition (legacy `bi-pencil`, bouton « Modifier »). */
export function IconeCrayon({ size, ...props }: IconeProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

/** Poubelle (legacy `bi-trash`, bouton « Supprimer »). */
export function IconePoubelle({ size, ...props }: IconeProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}
