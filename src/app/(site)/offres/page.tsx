import type { Metadata } from 'next'
import Link from 'next/link'

import {
  IconArrowRight,
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
import {
  NIVEAU_EXPERIENCE_LABELS,
  NIVEAU_EXPERIENCE_VALUES,
  OffresQuerySchema,
  TYPE_CONTRAT_LABELS,
  TYPE_CONTRAT_VALUES,
  type OffresQuery,
} from '@/lib/definitions'
import {
  listerCategoriesFiltre,
  listerOffresPubliques,
  type OffreCarte,
} from '@/lib/offres-public'
import { AutoSubmitOnChange } from './auto-submit'

// ─── Liste publique des offres (M5, tasks 2, 3 et 5) ─────────────────────────
//
// Rendu SERVEUR : page async + `await searchParams` sous loading.tsx racine.
// Le spike M5 (bug #98097) a conclu que la règle de suspension M2-M4 n'est
// PAS reproduite sur next 16.3.6 : ce protocole est validé pour le rapport.
//
// Parité legacy (OffrePubliqueController@index + offres/index.blade.php) :
// titre, sous-titre « N offre(s) disponible(s) », formulaire GET unique
// (q, ville, 3 selects de filtres) sans JavaScript requis, chips de filtre
// actif avec retrait unitaire, cartes (logo 52 px ou initiales, nom réel,
// date relative, 4 tags), 10 offres/page, tri date de publication
// décroissante, état vide identique. Les emojis 🏷💼📊 des options par
// défaut legacy sont le SEUL emoji de cette page : le système M2 en compte
// zéro (vérifié) et repose sur les icônes SVG maison — non portés, libellés
// textuels conservés.
//
// URL partageable : tous les paramètres (q, ville, categorie, type_contrat,
// niveau, page) sont lus via OffresQuerySchema (task 3) et RÉÉCRITS dans
// chaque lien (pagination, chips) — une URL copiée reproduit exactement
// l'écran. Validation : paramètre invalide ignoré (voir definitions.ts).
//
// Bugs legacy NON portés (vérifiés sur App\Models\Entreprise : `nom`) :
// initiales `substr(...->nom_entreprise ?? 'E')` (attribut inexistant →
// toujours « E »), nom d'entreprise `?? 'Entreprise'` (toujours « Entreprise »),
// tags en valeur brute (`stage`, ucfirst → `Sans_experience`), guard
// `@if($offre->categorie)` mort (categorieId obligatoire côté Prisma).
//
// Liens de la task 5 : le titre de chaque carte et le bouton « Voir »
// pointent vers /offres/<slug> (colonnes verrouillées depuis la task 4).
//
// Reste : task 6 (SEO), task 7 (cache), task 8 (états), task 9 (a11y),
// task 10 (rate limit), task 11 (accueil + clôture).
//
// Aucune donnée privée : select liste blanche (task 1). Requêtes par appel
// de page : count + page + catégories de filtre = 3 requêtes, AUCUNE par
// ligne (pas de N+1).
// ---------------------------------------------------------------------------

// Canonical : TOUTES les variantes d'URL (q, ville, filtres, page) pointent
// vers /offres — anti-duplicata standard des recherches filtrées, les
// résultats pertinents restent accessibles (la page reste dynamique et
// partageable, seul le signal SEO se normalise).
export const metadata: Metadata = {
  title: "Offres d'emploi",
  alternates: { canonical: '/offres' },
}

export default async function PageOffres({ searchParams }: PageProps<'/offres'>) {
  // Tous les champs du schéma rattrapent leur invalide (`.catch`) : la seule
  // façon d'échouer est un racine non-objet — impossible (Next garantit un
  // Record). Un échec se rendrait sur error.tsx, jamais sur un 500 silencieux.
  const filtres = OffresQuerySchema.parse(await searchParams)

  const [resultat, categories] = await Promise.all([
    listerOffresPubliques({
      q: filtres.q,
      ville: filtres.ville,
      categorie: filtres.categorie,
      typeContrat: filtres.type_contrat,
      niveau: filtres.niveau,
      page: filtres.page,
    }),
    listerCategoriesFiltre(),
  ])

  // Parité legacy : × visible dès qu'AU MOINS UN filtre est actif (la page
  // seule ne compte pas — anyFilled de la vue ne listait pas `page`).
  const filtreActif =
    filtres.q !== undefined ||
    filtres.ville !== undefined ||
    filtres.categorie !== undefined ||
    filtres.type_contrat !== undefined ||
    filtres.niveau !== undefined

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Offres d&apos;emploi
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {resultat.total} offre(s) disponible(s)
      </p>

      {/* Formulaire GET unique (décision d'étape 3) : le legacy scindait la
          recherche des 3 selects en formulaires multiples reliés par des
          inputs hidden — un seul form supprime cette catégorie de bugs. */}
      <form action="/offres" method="get">
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 shadow-card">
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
                defaultValue={filtres.q ?? ''}
                placeholder="Rechercher un poste, une compétence..."
                className="h-10 w-full rounded-sm border-[1.5px] border-line bg-surface pl-9 pr-3 text-sm text-ink transition-colors duration-fast placeholder:text-ink-muted focus:border-brand"
              />
            </div>
            <div className="relative w-full sm:w-[180px]">
              <label htmlFor="offres-ville" className="sr-only">
                Filtrer par ville
              </label>
              <IconMapPin
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                id="offres-ville"
                name="ville"
                type="text"
                autoComplete="off"
                defaultValue={filtres.ville ?? ''}
                placeholder="Ville..."
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
            {filtreActif ? (
              <Link
                href="/offres"
                aria-label="Réinitialiser les filtres"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink-muted transition-colors duration-fast hover:border-line-strong hover:text-ink"
              >
                <IconClose size={16} />
              </Link>
            ) : null}
          </div>
        </div>

        {/* Filtres rapides : 3 selects auto-soumis (parité onchange legacy)
            + chips des filtres actifs, le tout DANS le formulaire. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AutoSubmitOnChange>
            <select
              id="offres-categorie"
              name="categorie"
              aria-label="Filtrer par catégorie"
              defaultValue={String(filtres.categorie ?? '')}
              className={CLASSE_SELECT}
            >
              <option value="">Toutes catégories</option>
              {categories.map((categorie) => (
                <option key={categorie.id} value={String(categorie.id)}>
                  {categorie.nom}
                </option>
              ))}
            </select>
            <select
              id="offres-type"
              name="type_contrat"
              aria-label="Filtrer par type de contrat"
              defaultValue={filtres.type_contrat ?? ''}
              className={CLASSE_SELECT}
            >
              <option value="">Type de contrat</option>
              {TYPE_CONTRAT_VALUES.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {TYPE_CONTRAT_LABELS[valeur]}
                </option>
              ))}
            </select>
            <select
              id="offres-niveau"
              name="niveau"
              aria-label="Filtrer par niveau d'expérience"
              defaultValue={filtres.niveau ?? ''}
              className={CLASSE_SELECT}
            >
              <option value="">Niveau</option>
              {NIVEAU_EXPERIENCE_VALUES.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {NIVEAU_EXPERIENCE_LABELS[valeur]}
                </option>
              ))}
            </select>
          </AutoSubmitOnChange>

          {/* Filtres actifs : libellés propres (les artefacts `stage` /
              `Sans_experience` du blade ne sont pas portés). Le × retire CE
              paramètre et conserve les autres (parité request()->except()). */}
          {filtres.categorie !== undefined ? (
            <ChipFiltre
              texte={categories.find((c) => c.id === filtres.categorie)?.nom ?? ''}
              href={construireHref({ ...filtres, categorie: undefined })}
            />
          ) : null}
          {filtres.type_contrat !== undefined ? (
            <ChipFiltre
              texte={TYPE_CONTRAT_LABELS[filtres.type_contrat]}
              href={construireHref({ ...filtres, type_contrat: undefined })}
            />
          ) : null}
          {filtres.niveau !== undefined ? (
            <ChipFiltre
              texte={NIVEAU_EXPERIENCE_LABELS[filtres.niveau]}
              href={construireHref({ ...filtres, niveau: undefined })}
            />
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
          className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
        >
          {resultat.page > 1 ? (
            <Link
              href={construireHref({ ...filtres, page: resultat.page - 1 })}
              className={CLASSE_LIEN_PAGE}
            >
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
                href={construireHref({ ...filtres, page: item })}
                className={`${CLASSE_LIEN_PAGE} min-w-9 justify-center px-0`}
              >
                {item}
              </Link>
            ),
          )}

          {resultat.page < resultat.totalPages ? (
            <Link
              href={construireHref({ ...filtres, page: resultat.page + 1 })}
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
              <h3 className="text-base font-bold text-ink">
                <Link
                  href={`/offres/${offre.slug}`}
                  className="transition-colors duration-fast hover:text-brand"
                >
                  {offre.titre}
                </Link>
              </h3>
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

        {/* Parité h6 a href + « Voir » du blade : lien du titre (hover
            primary) et bouton bordé desktop-only (d-none d-md-block →
            hidden md:block). Variante outline-bleue inexistante en tokens
            M2 → secondary (bordé neutre du design system). */}
        <div className="hidden shrink-0 md:block">
          <Link
            href={`/offres/${offre.slug}`}
            className={buttonClassName('secondary', 'sm')}
          >
            Voir
            <IconArrowRight size={14} />
          </Link>
        </div>
      </div>
    </Card>
  )
}

// ─── Filtres actifs ──────────────────────────────────────────────────────────

/**
 * Chip de filtre actif (réf. `.filter-active-badge` legacy : fond bleu
 * clair, bordure bleue diluée — `border-brand/20` reproduit le #C7DCFF à
 * partir du seul token brand, aucun hex inventé). Le × est un lien GET qui
 * retire le paramètre courant en conservant tous les autres.
 */
function ChipFiltre({ texte, href }: { texte: string; href: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-tint px-2.5 py-1 text-xs font-medium text-brand-dark">
      {texte}
      <Link
        href={href}
        aria-label={`Retirer le filtre ${texte !== '' ? texte : 'catégorie'}`}
        className="text-brand transition-colors duration-fast hover:text-brand-dark"
      >
        <IconClose size={12} />
      </Link>
    </span>
  )
}

// ─── Pagination et liens ─────────────────────────────────────────────────────

const CLASSE_SELECT =
  'h-9 max-w-full cursor-pointer rounded-full border-[1.5px] border-line bg-surface px-4 text-sm text-ink-muted transition-colors duration-fast focus:border-brand'

const CLASSE_LIEN_PAGE =
  'inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-sm text-ink transition-colors duration-fast hover:border-line-strong'

/**
 * URL partageable : réécrit TOUS les filtres validés (+ page si > 1).
 * Une URL copiée depuis la pagination ou un chip reproduit l'écran exact ;
 * page 1 omise (URL canonique).
 */
function construireHref(filtres: OffresQuery): string {
  const params = new URLSearchParams()
  if (filtres.q !== undefined) params.set('q', filtres.q)
  if (filtres.ville !== undefined) params.set('ville', filtres.ville)
  if (filtres.categorie !== undefined) params.set('categorie', String(filtres.categorie))
  if (filtres.type_contrat !== undefined) params.set('type_contrat', filtres.type_contrat)
  if (filtres.niveau !== undefined) params.set('niveau', filtres.niveau)
  if (filtres.page !== undefined && filtres.page > 1) {
    params.set('page', String(filtres.page))
  }
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
