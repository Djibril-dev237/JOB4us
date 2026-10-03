// ─── Chargement de la liste /offres (M5, task 8) ─────────────────────────────
// Squelette calé sur la structure réelle de la page (titre, sous-titre,
// barre de recherche, cartes) plutôt que le squelette générique racine :
// il reste stable pendant les changements de searchParams et les
// navigations depuis l'accueil. Le pulse est neutralisé par
// prefers-reduced-motion via la règle globale de globals.css.
// États permanents de cette route (décidés aux tasks 2-3) : état vide
// « Aucune offre trouvée », 404 racine (not-found.tsx M2), erreur racine
// (error.tsx M2) — pas de doublon de copy.
// ---------------------------------------------------------------------------

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Chargement de la liste des offres"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="h-7 w-56 animate-pulse rounded-sm bg-surface-alt" />
      <div className="mt-2 h-4 w-40 animate-pulse rounded-sm bg-surface-alt" />
      <div className="mt-6 h-24 animate-pulse rounded-lg bg-surface-alt" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg bg-surface-alt"
          />
        ))}
      </div>
      <span className="sr-only">Chargement en cours…</span>
    </div>
  )
}
