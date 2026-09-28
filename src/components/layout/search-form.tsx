import { IconSearch } from '@/components/icons'

// ─── Recherche d'offres (header) ─────────────────────────────────────────────
// Formulaire GET natif vers /offres (champ q, héritage legacy OffrePublique).
// Sans JavaScript : la page de résultats fera le parsing des paramètres
// lors de la migration du module offres.
// Réf. recherche navbar PHP (app.blade.php) : repos fond gris sans bordure
// apparente, focus = bordure bleue + fond blanc, largeur 340px.
// Rendue uniquement pour les connectés (le visiteur cherche depuis le hero).
// ---------------------------------------------------------------------------

export function SearchForm() {
  return (
    <form action="/offres" method="get" role="search" className="hidden lg:block">
      <label htmlFor="header-search" className="sr-only">
        Rechercher une offre d&apos;emploi
      </label>
      <div className="relative">
        <IconSearch
          size={16}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
        />
        <input
          id="header-search"
          type="search"
          name="q"
          placeholder="Métier, mot-clé…"
          autoComplete="off"
          className="h-9 w-[340px] rounded-sm border-[1.5px] border-transparent bg-canvas pl-8 pr-2.5 text-sm text-ink transition-colors duration-fast placeholder:text-ink-muted focus:border-brand focus:bg-surface"
        />
      </div>
    </form>
  )
}
