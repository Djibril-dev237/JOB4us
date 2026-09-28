import type { HTMLAttributes } from 'react'

// ─── Badge / chip de statut ──────────────────────────────────────────────────
// Réf. : badges de statut du PHP (fond teinté + texte coloré, ex. « Envoyée »,
// « Vue »). Rayon pilule autorisé ici : ce ne sont pas des boutons (règle
// anti-vibecoding). Toutes les paires texte/teinte vérifiées AA (>= 4,5:1) ;
// la variante brand utilise brand-dark car brand sur brand-tint plafonne
// à 4,44:1 (état actif PHP, corrigé dans la sidebar).
// ---------------------------------------------------------------------------

export type BadgeVariant = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'accent'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-alt text-ink-muted',
  brand: 'bg-brand-tint text-brand-dark',
  ok: 'bg-ok-tint text-ok',
  warn: 'bg-warn-tint text-warn',
  danger: 'bg-danger-tint text-danger',
  accent: 'bg-accent-strong text-white',
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        VARIANT_CLASSES[variant]
      } ${className ?? ''}`}
      {...props}
    />
  )
}
