import type { ReactNode } from 'react'

// ─── État vide partagé des listes admin (M10) ────────────────────────────────
// L'icône est décorative, le message est fourni par l'appelant (source de
// libellés unique). Le bloc reste centré et lisible à 360 px.
// ---------------------------------------------------------------------------

interface EtatVideAdminProps {
  message: string
  icone?: ReactNode
}

export function EtatVideAdmin({ message, icone }: EtatVideAdminProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icone !== undefined && (
        <span aria-hidden="true" className="text-ink-muted opacity-25">
          {icone}
        </span>
      )}
      <p className="text-sm font-semibold text-ink-muted">{message}</p>
    </div>
  )
}
