import type { Metadata } from 'next'
import Link from 'next/link'

import {
  IconBarChart,
  IconBriefcase,
  IconClose,
  IconMapPin,
  IconSearch,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { dateRelativeFr } from '@/lib/dates'
import { NIVEAU_EXPERIENCE_LABELS, TYPE_CONTRAT_LABELS } from '@/lib/definitions'
import { listerOffresPubliques, type OffreCarte } from '@/lib/offres-public'

// ─── Liste publique des offres (M5, task 2) ──────────────────────────────────
//
// Rendu SERVEUR : page async + `await searchParams` sous loading.tsx racine.
// Le spike M5 (bug #98097) a conclu que la règle de suspension M2-M4 n'est
// PAS reproduite sur next 16.3.6 : ce protocole est validé et documenté
// pour le rapport final.
//
// Parité legacy (OffrePubliqueController@index + offres/index.blade.php) :
// titre « Offres d'emploi », sous-titre « N offre(s) disponible(s) »,
// recherche par mot-clé q via formulaire GET sans JavaScript, carte par
// offre (logo 52 px ou initiales, titre, nom d'entreprise, date relative,
// 4 tags), 10 offres/page, tri date de publication décroissante, état vide
// identique (« Aucune offre trouvée »).
//
// Bugs legacy NON portés (vérifiés sur le modèle App\Models\Entreprise :
// l'attribut est `nom`) :
// - initiales `substr($offre->entreprise->nom_entreprise ?? 'E')` : attribut
//   inexistant → toujours « E » → on lit le vrai `nom` (2 caractères) ;
// - nom d'entreprise `nom_entreprise ?? 'Entreprise'` → toujours
//   « Entreprise » → on affiche le vrai nom (relation obligatoire côté
//   Prisma, pas de fallback mort) ;
// - tags en valeur brute (`stage`, ucfirst → `Sans_experience`) → libellés
//   des selects legacy via definitions.ts ;
// - `@if($offre->categorie)` : guard inutile (categorieId obligatoire).
//
// Incréments reportés (ordre validé) :
// - task 3 : ville + filtres catégories/type/niveau, validation Zod de
//   l'URL, chips de filtres actifs — le parsing ci-dessous reste délibéré-
//   ment minimal (paramètre absent/invalide = ignoré, jamais d'erreur 500) ;
// - task 5 : lien du titre + bouton « Voir » (URL /offres/<slug> — la
//   colonne et le regex sont prêts depuis la task 4) ;
// - task 6 : description, canonical, JSON-LD.
//
// Aucune donnée privée : select liste blanche de la DAL (task 1), aucune
// requête par ligne (2 requêtes total : count + page).
// ---------------------------------------------------------------------------

export const metadata: Metadata = { title: "Offres d'emploi" }

export default async function PageOffres({ searchParams }: PageProps<'/offres'>) {
  const params = await searchParams

  // Parsing minimal (la validation Zod arrive en task 3) : q = chaîne
  // non vide, page = entier strict > 0, sinon paramètre ignoré.
  const qBrut = typeof params.q === 'string' ? params.q.trim() : ''
  const q = qBrut !== '' ? qBrut : undefined
  const pageBrute = typeof params.page === 'string' ? params.page : ''
  const pageDemandee = /^[1-9][0-9]*$/.test(pageBrute) ? Number(pageBrute) : 1

  const resultat = await listerOffresPubliques({ q, page: pageDemandee })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Offres d&apos;emploi
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {resultat.total} offre(s) disponible(s)
      </p>

      {/* Barre de recherche — un seul formulaire GET (décision d'étape 3) ;
          le × de réinitialisation apparaît dès qu'un filtre est actif. */}
      <form
        action="/offres"
        method="get"
        className="mt-6 rounded-lg border border-line bg-surface p-4 shadow-card"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative min-w-0 sm:flex-1">
            <label htmlFor="offres-q" className="sr-only">
              Rechercher une offre d&apos;emploi
            </label>
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              id="offres-q"
              name="q"
              type="text"
              autoComplete="off"
              defaultValue={q ?? ''}
              placeholder="Rechercher un poste, une compétence..."
              className="h-10 w-full rounded-sm border-[1.5px] border-line bg-surface pl-9 pr-3 text-sm text-ink transition-colors duration-fast placeholder:text-ink-muted focus:border-brand"
            />
          </div>
          <button
            type="submit"
            className={buttonClassName('primary', 'md', 'w-full sm:w-auto')}
          >
            <IconSearch size={16} />
            Rechercher
          </button>
          {q !== undefined ? (
            <a
              href="/offres"
              aria-label="Réinitialiser la recherche"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink-muted transition-colors duration-fast hover:border-line-strong hover:text-ink"
            >
              <IconClose size={16} />
            </a>
          ) : null}
        </div>
      </form>

      {resultat.offres.length === 0 ? (
        <Card className="mt-6 py-12 text-center">
          <IconBriefcase size={40} className="mx-auto text-ink-faint" />
          <p className="mt-3 font-semibold text-ink">Aucune offre trouvée</p>
          <p className="mt-1 text-sm text-ink-muted">
            Essayez de modifier vos critères de recherche
          </p>
        </Card>
      ) : (
        <ul className="mt-6 space-y-4">
          {resultat.offres.map((offre) => (
            <li key={offre.id}>
              <CarteOffre offre={offre} />
            </li>
          ))}
        </ul>
      )}

      {resultat.totalPages > 1 ? (
        <nav
          aria-label="Pagination des offres"
          className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
        >
          {resultat.page > 1 ? (
            <Link href={hrefOffres(q, resultat.page - 1)} className={CLASSE_LIEN_PAGE}>
              Précédent
            </Link>
          ) : (
            <span aria-disabled="true" className={`${CLASSE_LIEN_PAGE} text-ink-faint`}>
              Précédent
            </span>
          )}

          {pagesAffichees(resultat.page, resultat.totalPages).map((item, index) =>
            item === '…' ? (
              <span key={`ellipsis-${index}`} className="px-1 text-ink-muted" aria-hidden="true">
                …
              </span>
            ) : item === resultat.page ? (
              <span
                key={item}
                aria-current="page"
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm bg-brand px-3 text-sm font-medium text-white"
              >
                {item}
              </span>
            ) : (
              <Link
                key={item}
                href={hrefOffres(q, item)}
                className={`${CLASSE_LIEN_PAGE} min-w-9 justify-center px-0`}
              >
                {item}
              </Link>
            ),
          )}

          {resultat.page < resultat.totalPages ? (
            <Link
              href={hrefOffres(q, resultat.page + 1)}
              className={CLASSE_LIEN_PAGE}
            >
              Suivant
            </Link>
          ) : (
            <span aria-disabled="true" className={`${CLASSE_LIEN_PAGE} text-ink-faint`}>
              Suivant
            </span>
          )}
        </nav>
      ) : null}
    </div>
  )
}

// ─── Carte d'offre ───────────────────────────────────────────────────────────

/**
 * Carte de la liste (réf. `.offre-card` legacy) : logo 52 px (initiales
 * en secours — le bug « toujours E » n'est pas porté), nom et titre réels,
 * date relative, 4 tags pilule. Les couleurs de tags suivent les tokens
 * M2 : le violet legacy `#7C3AED` (tag-categorie) n'existe pas dans la
 * palette validée — variante neutre retenue, aucun token inventé.
 */
function CarteOffre({ offre }: { offre: OffreCarte }) {
  return (
    <Card className="transition-shadow duration-fast hover:border-line-strong hover:shadow-lift">
      <div className="flex items-start gap-3">
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-tint text-sm font-bold text-brand">
          {offre.entreprise.logo !== null ? (
            /* eslint-disable-next-line @next/next/no-img-element -- URL publique (option B) : /api/files/logo redirige (302) vers une signature de 5 minutes avec Cache-Control public 300 s — l'optimiseur d'images Next ajouterait un cache intermédiaire et un domaine à déclarer pour un fichier non statique. */
            <img
              src={`/api/files/logo?entrepriseId=${offre.entreprise.id}`}
              alt=""
              className="h-full w-full rounded-md object-cover"
            />
          ) : (
            offre.entreprise.nom.slice(0, 2).toUpperCase()
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {/* Lien du titre (« hover-primary ») et bouton « Voir » :
                  task 5, URL /offres/<slug> — décision d'ordre validée. */}
              <h3 className="text-base font-bold text-ink">{offre.titre}</h3>
              <p className="mt-1 text-sm font-medium text-brand">
                {offre.entreprise.nom}
              </p>
            </div>
            <time
              dateTime={offre.createdAt.toISOString()}
              className="shrink-0 text-xs text-ink-muted"
            >
              {dateRelativeFr(offre.createdAt)}
            </time>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="brand" className="gap-1">
              <IconBriefcase size={14} />
              {TYPE_CONTRAT_LABELS[offre.typeContrat]}
            </Badge>
            <Badge variant="warn" className="gap-1">
              <IconMapPin size={14} />
              {offre.ville}
            </Badge>
            <Badge variant="ok" className="gap-1">
              <IconBarChart size={14} />
              {NIVEAU_EXPERIENCE_LABELS[offre.niveauExperience]}
            </Badge>
            <Badge>{offre.categorie.nom}</Badge>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Pagination ──────────────────────────────────────────────────────────────

const CLASSE_LIEN_PAGE =
  'inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-sm text-ink transition-colors duration-fast hover:border-line-strong'

/** URL partageable : conserve le mot-clé q, omet la page 1 (URL canonique). */
function hrefOffres(q: string | undefined, page: number): string {
  const params = new URLSearchParams()
  if (q !== undefined) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs === '' ? '/offres' : `/offres?${qs}`
}

/**
 * Fenêtre de pages : toutes les pages si ≤ 7 (cas réel), sinon première,
 * dernière et ±1 autour de la courante avec « … » (fenêtre ±1 des
 * paginateurs standards). Les libellés/guillemets du paginator Laravel
 * sont invérifiables ici : vendor/ absent du dépôt — « Précédent » et
 * « Suivant » retenus, choix assumé.
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
