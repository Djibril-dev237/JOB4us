import type { ReactNode } from 'react'

// ─── En-tête commun des écrans d'administration (M10) ────────────────────────
// Un seul h1 par page, une description courte et des actions optionnelles.
// Le bloc se replie à 360 px : le titre garde toute la largeur, les actions
// passent dessous sans jamais provoquer de défilement horizontal.
// ---------------------------------------------------------------------------

interface EnTeteAdminProps {
  titre: string
  description?: string
  actions?: ReactNode
}

export function EnTeteAdmin({ titre, description, actions }: EnTeteAdminProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{titre}</h1>
        {description !== undefined && (
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}
