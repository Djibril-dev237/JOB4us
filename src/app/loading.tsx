// ─── Chargement global ───────────────────────────────────────────────────────
// Squelette sobre aligné sur la grille du contenu (cartes de la hauteur d'une
// ligne d'offre). Le pulse est neutralisé par prefers-reduced-motion via la
// règle globale de globals.css.
// ---------------------------------------------------------------------------

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Chargement de la page"
      className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8"
    >
      <div className="h-7 w-56 animate-pulse rounded-sm bg-surface-alt" />
      <div className="mt-8 space-y-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-lg bg-surface-alt" />
        ))}
      </div>
      <span className="sr-only">Chargement en cours…</span>
    </div>
  )
}
