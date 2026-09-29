import Link from 'next/link'

import { HomeCategories } from '@/components/home/home-categories'
import { HomeStats } from '@/components/home/home-stats'
import { IconSearch } from '@/components/icons'

// ─── Accueil ───────────────────────────────────────────────────────────────
// Reproduction en direction « PHP+ » de accueil.blade.php, section par
// section, avec les écarts assumés :
// - hero et CTA final en aplat #0066FF (les dégradés 135° du PHP sont
//   retirés — règle anti-vibecoding) ;
// - superlatifs et fausses métriques retirés (« plateforme #1 », « des
//   milliers d'offres », « Rejoignez des milliers de candidats ») : copy
//   remplacée par des faits vérifiables ;
// - « Populaire : » devient « Suggestions : » (les tags ne sont pas des
//   données mesurées) ;
// - libellés du hero blancs pleins (4,84:1) au lieu de rgba(.7) (≈ 3,1:1) ;
// - « Postulez en 1 clic » devient « Postulez en ligne » (le parcours réel est
//   un formulaire) ; « milliers d'offres » supprimé des étapes ;
// - « Offres récentes » reportée au module offres (M3, périmètre validé) ;
// - pas d'icônes par catégorie (jeu maison non compatible bootstrap-icons).
//
// Page STRICTEMENT synchrone (règle de suspension #98097) : compteurs et
// catégories sont chargés côté client via /api/home/* (DAL réservée aux route
// handlers). Ancres legacy reprises : #categories et #comment, référencées
// par la nav visiteur (PUBLIC_NAV).
// ---------------------------------------------------------------------------

const SEARCH_TAGS = [
  'Développeur',
  'Comptable',
  'Commercial',
  'Marketing',
  'RH',
]

interface Step {
  title: string
  description: string
}

const CANDIDAT_STEPS: Step[] = [
  {
    title: 'Créez votre profil',
    description:
      'Inscrivez-vous gratuitement et complétez votre profil avec votre CV et vos compétences.',
  },
  {
    title: 'Cherchez des offres',
    description:
      'Parcourez les offres disponibles et filtrez selon vos critères.',
  },
  {
    title: 'Postulez en ligne',
    description:
      'Envoyez votre candidature directement depuis la plateforme et suivez son statut.',
  },
]

const RECRUTEUR_STEPS: Step[] = [
  {
    title: 'Créez votre espace',
    description:
      'Inscrivez votre entreprise et complétez votre profil pour attirer les meilleurs candidats.',
  },
  {
    title: 'Publiez vos offres',
    description:
      "Rédigez et publiez vos offres d'emploi en quelques minutes.",
  },
  {
    title: 'Gérez les candidatures',
    description:
      'Recevez et gérez les candidatures, échangez avec les candidats par messagerie.',
  },
]

interface StepsColumn {
  badge: string
  steps: Step[]
  /** Fonds du badge et du numéro : brand (candidat) / accent-strong (recruteur). */
  tone: 'brand' | 'accent'
}

const STEPS_COLUMNS: StepsColumn[] = [
  {
    badge: 'Pour les candidats',
    tone: 'brand',
    steps: CANDIDAT_STEPS,
  },
  {
    badge: 'Pour les recruteurs',
    tone: 'accent',
    steps: RECRUTEUR_STEPS,
  },
]

const TONE_CLASSES: Record<StepsColumn['tone'], string> = {
  brand: 'bg-brand',
  accent: 'bg-accent-strong',
}

export default function Home() {
  return (
    <>
      {/* ─── Hero : aplat brand (dégradé PHP retiré) ──────────────────── */}
      <section className="bg-brand py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h1 className="max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl">
            Trouvez votre emploi idéal au{' '}
            <span className="underline decoration-2 underline-offset-[6px]">
              Cameroun
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white">
            La plateforme qui relie candidats et recruteurs au Cameroun et en
            Afrique centrale. Inscription gratuite, offres centralisées,
            candidatures suivies.
          </p>

          {/* Recherche : formulaire GET natif (sans JS), comme le header. */}
          <form
            action="/offres"
            method="get"
            role="search"
            className="mt-8 max-w-2xl"
          >
            <div className="flex flex-col gap-2 rounded-md bg-white p-2 shadow-lift sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
                <IconSearch
                  size={18}
                  className="shrink-0 text-ink-faint"
                  aria-hidden="true"
                />
                <label htmlFor="hero-q" className="sr-only">
                  Titre du poste, compétence
                </label>
                <input
                  id="hero-q"
                  name="q"
                  type="search"
                  placeholder="Titre du poste, compétence…"
                  autoComplete="off"
                  className="h-10 w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                />
              </div>
              <div
                aria-hidden="true"
                className="hidden h-6 w-px bg-line sm:block"
              />
              <div className="flex items-center gap-2 px-2">
                <label htmlFor="hero-ville" className="sr-only">
                  Ville
                </label>
                <input
                  id="hero-ville"
                  name="ville"
                  type="text"
                  placeholder="Ville…"
                  autoComplete="address-level2"
                  className="h-10 w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint sm:w-40"
                />
              </div>
              <button
                type="submit"
                className="h-10 shrink-0 rounded-sm bg-brand px-5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-dark"
              >
                Rechercher
              </button>
            </div>
          </form>

          {/* Tags du hero : « Populaire » → « Suggestions » (pas de mesure). */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-sm text-white">Suggestions :</span>
            {SEARCH_TAGS.map((tag) => (
              <Link
                key={tag}
                href={`/offres?q=${encodeURIComponent(tag)}`}
                className="rounded-sm border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-fast hover:bg-white/20"
              >
                {tag}
              </Link>
            ))}
          </div>

          <HomeStats />
        </div>
      </section>

      {/* Catégories réelles (#categories) : rendu conditionnel côté client. */}
      <HomeCategories />

      {/* ─── Comment ça marche (#comment) : fond how-bg PHP #F8FAFF ───── */}
      <section id="comment" className="bg-surface-alt py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-ink">
              Comment ça marche&nbsp;?
            </h2>
            <p className="mt-2 text-base text-ink-muted">
              Simple, rapide et efficace
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {STEPS_COLUMNS.map((column) => (
              <div key={column.badge}>
                {/* Badges de section pleins : assortis aux numéros (le PHP
                    mélangeait badge teinté et numéro plein ; le texte blanc
                    sur accent-strong tient 4,7:1). */}
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold text-white ${TONE_CLASSES[column.tone]}`}
                >
                  {column.badge}
                </span>

                <ul className="mt-4 space-y-3">
                  {column.steps.map((step, index) => (
                    <li key={step.title}>
                      <article className="flex gap-4 rounded-lg border border-line bg-white p-7 shadow-card transition-shadow duration-fast hover:border-brand hover:shadow-lift">
                        <span
                          aria-hidden="true"
                          className={`flex size-10 shrink-0 items-center justify-center rounded-sm text-base font-extrabold text-white ${TONE_CLASSES[column.tone]}`}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-ink">
                            {step.title}
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                            {step.description}
                          </p>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA final : aplat brand (dégradé PHP retiré) ─────────────── */}
      <section className="bg-brand py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Prêt à trouver votre prochain emploi&nbsp;?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-white">
            Créez votre compte gratuit pour publier vos offres ou postuler aux
            offres disponibles.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-11 items-center rounded-sm bg-white px-5 text-sm font-semibold text-brand transition-colors duration-fast hover:bg-canvas"
            >
              Créer un compte gratuit
            </Link>
            <Link
              href="/offres"
              className="inline-flex h-11 items-center rounded-sm border border-white px-5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-white/10"
            >
              Parcourir les offres
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
