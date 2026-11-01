import type { ReactNode } from 'react'

// ─── Tuile de statistique admin (M10) ────────────────────────────────────────
// Une valeur réelle, un libellé court, un détail facultatif. Aucun graphique,
// aucune animation : la donnée est le seul contenu. `tabular-nums` garde les
// colonnes alignées à 360 px comme à 1280 px.
// ---------------------------------------------------------------------------

export type TonStatistique = 'neutre' | 'ok' | 'attention' | 'danger'

const TON_CLASSES: Record<TonStatistique, string> = {
  neutre: 'text-ink',
  ok: 'text-ok',
  attention: 'text-warn',
  danger: 'text-danger',
}

interface CarteStatistiqueProps {
  libelle: string
  valeur: number | string
  detail?: string
  ton?: TonStatistique
  icone?: ReactNode
}

export function CarteStatistique({
  libelle,
  valeur,
  detail,
  ton = 'neutre',
  icone,
}: CarteStatistiqueProps) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {libelle}
        </p>
        {icone !== undefined && (
          <span aria-hidden="true" className="shrink-0 text-ink-muted">
            {icone}
          </span>
        )}
      </div>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${TON_CLASSES[ton]}`}>
        {valeur}
      </p>
      {detail !== undefined && (
        <p className="mt-1 text-xs text-ink-muted">{detail}</p>
      )}
    </div>
  )
}
