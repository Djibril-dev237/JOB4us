// ─── Chargement de la fiche /offres/<slug> (M5, task 8) ──────────────────────
// Squelette calé sur les deux colonnes de la fiche (en-tête, description,
// colonne droite) — il remplace le squelette de liste hérité de
// offres/loading.tsx à l'arrivée sur une fiche. Pulse neutralisé par
// prefers-reduced-motion (globals.css). État 404 : not-found.tsx racine
// (M2), déclenché par notFound() de la page et de generateMetadata.
// ---------------------------------------------------------------------------

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Chargement de l'offre"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg bg-surface-alt p-5">
            <div className="flex items-start gap-3">
              <div className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-surface" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-6 w-3/4 animate-pulse rounded-sm bg-surface" />
                <div className="h-4 w-40 animate-pulse rounded-sm bg-surface" />
                <div className="h-7 w-64 max-w-full animate-pulse rounded-full bg-surface" />
              </div>
            </div>
          </div>
          <div className="h-52 animate-pulse rounded-lg bg-surface-alt" />
        </div>
        <div className="space-y-4">
          <div className="h-64 animate-pulse rounded-lg bg-surface-alt" />
          <div className="h-44 animate-pulse rounded-lg bg-surface-alt" />
        </div>
      </div>
      <span className="sr-only">Chargement en cours…</span>
    </div>
  )
}
