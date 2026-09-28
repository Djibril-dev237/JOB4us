import type { HTMLAttributes } from 'react'

// ─── Carte de contenu ────────────────────────────────────────────────────────
// Unité de base de la direction B : une seule couche (jamais carte dans
// carte), rayon 8px maximum, ombre légère au repos (shadow-lift au survol
// est réservé aux listes de cartes cliquables).
// ---------------------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface p-5 shadow-card ${className ?? ''}`}
      {...props}
    />
  )
}
