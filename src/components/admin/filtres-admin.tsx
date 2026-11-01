import Link from 'next/link'

// ─── Filtres admin rectangulaires (M10) ──────────────────────────────────────
// Contrôles de 36 px de haut, rayon 8 px (token --radius-sm), jamais de
// pilule. L'état actif est porté par `aria-current` et un fond de marque ;
// le lien reste cliquable pour recharger le filtre courant (comportement des
// listes M7/M8). Les libellés viennent toujours de l'appelant.
// ---------------------------------------------------------------------------

export interface FiltreAdminItem {
  label: string
  href: string
  actif: boolean
}

interface FiltresAdminProps {
  items: FiltreAdminItem[]
  ariaLabel: string
}

export function FiltresAdmin({ items, ariaLabel }: FiltresAdminProps) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.actif ? 'page' : undefined}
          className={`inline-flex h-9 items-center rounded-sm border px-3 text-sm font-medium transition-colors duration-fast ${
            item.actif
              ? 'border-brand bg-brand text-white'
              : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-alt hover:text-ink'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
