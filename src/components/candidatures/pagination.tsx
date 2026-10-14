import Link from 'next/link'

// ─── Pagination des listes de candidatures (M7, composant partagé) ───────────
//
// Composant SERVEUR pur : aucune directive 'use client', aucun hook, aucune
// donnée lue — les DEUX espaces qui l'emploient (/candidat/candidatures et
// l'espace recruteur, écrit en parallèle) ne fournissent que des nombres,
// un chemin et les filtres à conserver.
//
// Fenêtre de pages : reprise du motif M5 (src/app/(site)/offres/page.tsx,
// `pagesAffichees`) — toutes les pages si ≤ 7, sinon première, dernière et
// ±1 autour de la courante, séparées par « … ». Libellés « Précédent » /
// « Suivant » déjà retenus en M5 (paginator Laravel invérifiable : vendor/
// absent du dépôt) — aucun libellé inventé ici.
//
// URL partageable : `parametres` (filtres) est recopié via URLSearchParams,
// `undefined` = paramètre OMIS ; `page` est écrite APRÈS les filtres — un
// éventuel `page` parasite dans `parametres` est donc écrasé, jamais laissé
// en double — et omise vaut 1 (URL canonique, motif M5). Aucun autre
// paramètre de l'URL d'origine n'est repris : le lien ne contient que ce
// que l'appelant a déclaré conserver.
//
// A11y : <nav> nommé, page courante en `aria-current="page"` (un <span>,
// jamais un lien vers soi-même), Précédent/Suivant désactivés aux bornes
// par <button disabled> (motif M5) plutôt que par un lien sans cible.
// `pages <= 1` → `null` : une liste d'une seule page n'affiche AUCUNE barre.
// ---------------------------------------------------------------------------

export interface PaginationProps {
  /** Page effectivement rendue (le DAL ne la plafonne pas — URL périmée = page vide). */
  page: number
  /** Nombre total de pages (au moins 1, même à total nul). */
  pages: number
  /** Chemin de la liste, sans query string. */
  chemin: string
  /** Paramètres de filtre à CONSERVER dans chaque lien (undefined = omis). */
  parametres?: Record<string, string | undefined>
  /**
   * Nom accessible de la barre (nav). Défaut = libellé de l'écran M5/M7
   * d'origine ; un écran qui RÉUTILISE la barre (modération M8) passe son
   * propre libellé — un lecteur d'écran ne doit jamais entendre « candidatures »
   * au-dessus d'une file de signalements.
   */
  ariaLabel?: string
}

/** Lien de page (motif M5) : mêmes bornes, même rayon, motion token M2. */
const CLASSE_LIEN_PAGE =
  'inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-sm text-ink transition-colors duration-fast hover:border-line-strong'

/** Page en cours : pastille pleine, jamais un lien actif (aria-current suffit). */
const CLASSE_PAGE_COURANTE =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-sm bg-brand px-3 text-sm font-medium text-white'

/** État désactivé de Précédent/Suivant (gabarit exact de M5). */
const CLASSE_DESACTIVE = `${CLASSE_LIEN_PAGE} text-ink-faint disabled:pointer-events-none`

/**
 * URL d'une page : les filtres déclarés sont conservés tels quels, `page`
 * est posée par-dessus et omise pour la page 1.
 */
function construireHref(
  chemin: string,
  parametres: Record<string, string | undefined> | undefined,
  page: number,
): string {
  const params = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(parametres ?? {})) {
    if (valeur !== undefined) params.set(cle, valeur)
  }
  if (page > 1) params.set('page', String(page))

  const query = params.toString()
  return query === '' ? chemin : `${chemin}?${query}`
}

/**
 * Fenêtre affichée : toutes les pages si ≤ 7, sinon première, dernière et
 * ±1 autour de la courante, avec « … » dès qu'un écart subsiste (motif M5,
 * implémentation reprise à l'identique — une seule fenêtre dans le dépôt).
 */
function pagesAffichees(page: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const candidats = [1, page - 1, page, page + 1, totalPages].filter(
    (p) => p >= 1 && p <= totalPages,
  )
  const uniques = [...new Set(candidats)].sort((a, b) => a - b)

  const suite: Array<number | '…'> = []
  let precedent = 0
  for (const p of uniques) {
    if (precedent !== 0 && p - precedent > 1) suite.push('…')
    suite.push(p)
    precedent = p
  }
  return suite
}

export function Pagination({
  page,
  pages,
  chemin,
  parametres,
  ariaLabel = 'Pagination des candidatures',
}: PaginationProps) {
  // Une seule page : pas de barre du tout (ni Précédent/Suivant inutiles,
  // ni numéro unique qui ne serait pas un lien).
  if (pages <= 1) return null

  return (
    <nav
      aria-label={ariaLabel}
      className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
    >
      {page > 1 ? (
        <Link href={construireHref(chemin, parametres, page - 1)} className={CLASSE_LIEN_PAGE}>
          Précédent
        </Link>
      ) : (
        <button type="button" disabled className={CLASSE_DESACTIVE}>
          Précédent
        </button>
      )}

      {pagesAffichees(page, pages).map((item, index) =>
        item === '…' ? (
          <span key={`ellipsis-${index}`} className="px-1 text-ink-muted" aria-hidden="true">
            …
          </span>
        ) : item === page ? (
          <span key={item} aria-current="page" className={CLASSE_PAGE_COURANTE}>
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={construireHref(chemin, parametres, item)}
            aria-label={`Page ${item}`}
            className={`${CLASSE_LIEN_PAGE} min-w-9 justify-center px-0`}
          >
            {item}
          </Link>
        ),
      )}

      {page < pages ? (
        <Link href={construireHref(chemin, parametres, page + 1)} className={CLASSE_LIEN_PAGE}>
          Suivant
        </Link>
      ) : (
        <button type="button" disabled className={CLASSE_DESACTIVE}>
          Suivant
        </button>
      )}
    </nav>
  )
}
