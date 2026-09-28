import type { HTMLAttributes } from 'react'

// ─── Carte de contenu ────────────────────────────────────────────────────────
// Unité de base du design « PHP+ » : une seule couche (jamais carte dans
// carte), rayon 12px (token --radius-md, réf. cartes PHP radius 14px),
// ombre card au repos (shadow-lift au survol est réservé aux listes de
// cartes cliquables).
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md border border-line bg-surface p-5 shadow-card ${className ?? ''}`}
      {...props}
    />
  )
}
