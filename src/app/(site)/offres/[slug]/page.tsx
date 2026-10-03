import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  IconArrowRight,
  IconBarChart,
  IconBriefcase,
  IconBuilding,
  IconFileText,
  IconGrid,
  IconInfo,
  IconMapPin,
  IconTag,
  IconWrench,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { NIVEAU_EXPERIENCE_LABELS, TYPE_CONTRAT_LABELS } from '@/lib/definitions'
import {
  lireOffrePublique,
  listerOffresSimilaires,
  type OffreDetail,
} from '@/lib/offres-public'

// ─── Fiche publique d'une offre (M5, task 5) ─────────────────────────────────
//
// URL : /offres/<slug> (contrate task 4 : « titre-slug-<id> »). L'entrée
// legacy /offres/<id> numérique répond 404 — le regex de src/lib/slug.ts
// rejette l'ancien format AVANT toute requête, puis la DAL applique le
// prédicat unique : brouillon, expirée, recruteur suspendu et slug inconnu
// produisent tous notFound() — 404 strictement identique, aucune fuite
// d'existence. La règle du spike #98097 (rendu serveur async, suspension
// M2-M4 non reproduite en 16.3.6) s'applique ici aussi.
//
// Parité legacy (offres/show.blade.php) : en-tête (logo 64 px, titre, nom
// d'entreprise, 4 badges dont pays), Description (nl2br → whitespace-pre-wrap,
// jamais de HTML injecté), Compétences requises (si présentes), Offres
// similaires (4 max, lignes cliquables), colonne droite « Détails »
// (contrat, niveau, localisation, salaire FCFA si salaire_visible, dates)
// et « À propos de l'entreprise ». Libellés propres (les artefacts `stage`,
// ucfirst `Sans_experience` du blade ne sont pas portés) ; le violet
// badge-categorie n'existe pas en tokens M2 → neutre.
//
// Hors périmètre M5 (reporté en M7) : carte de candidature (postuler,
// sauvegarder, déjà postulé, contacter le recruteur), modal de candidature,
// détection d'état auth — la fiche M5 est strictement passive. Le SEO
// (generateMetadata) est la task 6.
//
// Requêtes : findFirst (fiche) + findMany (similaires) = 2, aucune par ligne.
// ---------------------------------------------------------------------------

/** Dates publiques figées sur le fuseau de la cible (choix M5, cf. DAL). */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** Parité `number_format($x, 0, ',', ' ')` legacy : « 1 500 ». */
const FORMATEUR_MONTANT = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

// Dédoublonnage generateMetadata ↔ page : une SEULE requête findFirst par
// requête client au lieu de deux (motif React cache documenté par Next).
// Clé = slug seul : `now` est donc évalué une fois, metadata et corps de
// page partagent la même frontière d'expiration.
const lireOffreMiseEnCache = cache(lireOffrePublique)

/**
 * SEO de la fiche (task 6) : parité stricte avec `@section('title',
 * $offre->titre)` — titre seul, description héritée du layout racine
 * (le legacy n'avait ni meta description, ni canonical, ni og:, vérifié
 * sur layouts/app.blade.php). Canonical : /offres/<slug> est la forme
 * canonique publiée par la task 4 ; l'entrée legacy /offres/<id> n'a
 * jamais d'URL canonique (elle 404). Slug non visible → notFound()
 * aussi ici : même 404 que le corps de page, aucune fuite d'existence
 * dans le HTML du <head>.
 */
export async function generateMetadata({
  params,
}: PageProps<'/offres/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const offre = await lireOffreMiseEnCache(slug)
  if (offre === null) notFound()

  return {
    title: offre.titre,
    alternates: { canonical: `/offres/${offre.slug}` },
  }
}

export default async function PageOffre({ params }: PageProps<'/offres/[slug]'>) {
  const { slug } = await params
  const offre = await lireOffreMiseEnCache(slug)
  if (offre === null) notFound()

  const similaires = await listerOffresSimilaires(offre.categorie.id, offre.id)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonne principale */}
        <div className="space-y-4 lg:col-span-2">
          {/* En-tête de l'offre */}
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-tint text-base font-bold text-brand">
                {offre.entreprise.logo !== null ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- URL publique (option B) : 302 vers signature 5 minutes, Cache-Control public 300 s — l'optimiseur d'images Next ajouterait un cache non maîtrisé. */
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
                <h1 className="text-2xl font-bold tracking-tight text-ink">
                  {offre.titre}
                </h1>
                <p className="mt-1 font-semibold text-brand">{offre.entreprise.nom}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="brand" className="gap-1 px-3 py-2">
                    <IconBriefcase size={14} />
                    {TYPE_CONTRAT_LABELS[offre.typeContrat]}
                  </Badge>
                  <Badge variant="warn" className="gap-1 px-3 py-2">
                    <IconMapPin size={14} />
                    {offre.ville}
                    {offre.pays !== '' ? `, ${offre.pays}` : ''}
                  </Badge>
                  <Badge variant="ok" className="gap-1 px-3 py-2">
                    <IconBarChart size={14} />
                    {NIVEAU_EXPERIENCE_LABELS[offre.niveauExperience]}
                  </Badge>
                  <Badge className="gap-1 px-3 py-2">
                    <IconTag size={14} />
                    {offre.categorie.nom}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          {/* Description — nl2br(e()) legacy : texte échappé + retours à la
              ligne. `whitespace-pre-wrap` produit le même rendu sans jamais
              interpréter du HTML (anti-XSS, aucun dangerouslySetInnerHTML). */}
          <Card>
            <TitreSection icone={<IconFileText size={18} />}>
              Description du poste
            </TitreSection>
            <p className="mt-3 text-[0.95rem] leading-[1.8] whitespace-pre-wrap text-ink-muted">
              {offre.description}
            </p>
          </Card>

          {/* Compétences — carte absente au legacy si vide (identique ici). */}
          {offre.competences.length > 0 ? (
            <Card>
              <TitreSection icone={<IconWrench size={18} />}>
                Compétences requises
              </TitreSection>
              <div className="mt-3 flex flex-wrap gap-2">
                {offre.competences.map((item) => (
                  <Badge key={item.competence.nom} variant="brand" className="px-3 py-2">
                    {item.competence.nom}
                  </Badge>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Similaires : lignes pleine largeur (card-body p-0 legacy →
              conteneur dédié, le composant Card a un padding fixe). */}
          {similaires.length > 0 ? (
            <section className="overflow-hidden rounded-md border border-line bg-surface shadow-card">
              <h2 className="flex items-center gap-2 border-b border-line px-5 py-4 text-base font-semibold text-ink">
                <span className="text-brand">
                  <IconGrid size={18} />
                </span>
                Offres similaires
              </h2>
              <ul className="divide-y divide-line">
                {similaires.map((similaire) => (
                  <li key={similaire.id}>
                    <Link
                      href={`/offres/${similaire.slug}`}
                      className="flex items-center gap-3 p-3 transition-colors duration-fast hover:bg-surface-alt"
                    >
                      {/* Parité stricte : la ligne similaire affiche les
                          initiales au legacy, pas le logo image. */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-tint text-xs font-bold text-brand">
                        {similaire.entreprise.nom.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">{similaire.titre}</p>
                        <p className="text-xs text-brand">{similaire.entreprise.nom}</p>
                        <p className="text-xs text-ink-muted">
                          {similaire.ville} · {TYPE_CONTRAT_LABELS[similaire.typeContrat]}
                        </p>
                      </div>
                      <IconArrowRight size={16} className="shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Colonne droite — le bloc candidature (postuler / sauvegarder /
            contacter) appartient à M7 : aucune logique d'état auth en M5. */}
        <div className="space-y-4">
          <Card>
            <TitreSection icone={<IconInfo size={18} />}>Détails</TitreSection>
            <ul className="mt-1 divide-y divide-line">
              <LigneDetail
                label="Type de contrat"
                valeur={TYPE_CONTRAT_LABELS[offre.typeContrat]}
              />
              <LigneDetail
                label="Niveau requis"
                valeur={NIVEAU_EXPERIENCE_LABELS[offre.niveauExperience]}
              />
              <LigneDetail label="Localisation" valeur={offre.ville} />
              {offre.salaireMin !== null && offre.salaireVisible ? (
                <LigneDetail
                  label="Salaire"
                  className="text-ok"
                  valeur={formatSalaire(offre.salaireMin, offre.salaireMax)}
                />
              ) : null}
              <LigneDetail
                label="Publiée le"
                valeur={FORMATEUR_DATE.format(offre.createdAt)}
              />
              <LigneDetail
                label="Expire le"
                className="text-danger"
                valeur={FORMATEUR_DATE.format(offre.dateExpiration)}
              />
            </ul>
          </Card>

          {/* À propos — parité stricte : initiales (pas d'image) au legacy. */}
          <Card className="text-center">
            <span className="flex">
              <TitreSection icone={<IconBuilding size={18} />}>
                À propos de l&apos;entreprise
              </TitreSection>
            </span>
            <div className="mx-auto mt-4 flex h-[60px] w-[60px] items-center justify-center rounded-md bg-brand-tint text-base font-bold text-brand">
              {offre.entreprise.nom.slice(0, 2).toUpperCase()}
            </div>
            <p className="mt-3 font-bold text-ink">{offre.entreprise.nom}</p>
            {offre.entreprise.secteurActivite !== null ? (
              <p className="mt-1 text-sm text-ink-muted">
                {offre.entreprise.secteurActivite}
              </p>
            ) : null}
            {offre.entreprise.ville !== null ? (
              <p className="mt-1 flex items-center justify-center gap-1 text-sm text-ink-muted">
                <IconMapPin size={14} />
                {offre.entreprise.ville}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Fragments locaux ────────────────────────────────────────────────────────

/** Titre de section de carte (réf. card-header legacy : icône bleue + label). */
function TitreSection({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
      <span className="text-brand">{icone}</span>
      {children}
    </h2>
  )
}

/** Ligne « Détails » (réf. justify-content-between + border de la liste). */
function LigneDetail({
  label,
  valeur,
  className,
}: {
  label: string
  valeur: string
  className?: string | undefined
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className={`text-sm font-medium ${className ?? 'text-ink'}`}>{valeur}</span>
    </li>
  )
}

/**
 * Parity `number_format($salaire, 0, ',', ' ') FCFA` : « 1 500 » ou
 * « 1 500 — 2 000 FCFA ». Le type Decimal de Prisma passe par Number()
 * (decimal.js valueOf → string numérique) — jamais de virgule décimale,
 * le legacy tronquait aussi à 0 décimale.
 */
function formatSalaire(
  min: NonNullable<OffreDetail['salaireMin']>,
  max: OffreDetail['salaireMax'],
): string {
  const bornes = max !== null ? ` — ${FORMATEUR_MONTANT.format(Number(max))}` : ''
  return `${FORMATEUR_MONTANT.format(Number(min))}${bornes} FCFA`
}
