import type { ReactNode } from 'react'
import Link from 'next/link'
import type { NiveauExperience, TypeContrat } from '@prisma/client'

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
import type { OffreCarte, OffreDetail } from '@/lib/offres-public'

// ─── Fiche d'une offre (D10 : JSX extrait de la page M5, M6) ─────────────────
//
// Composant PRÉSENTATIONNEL PUR : ni prisma, ni `server-only`, ni fetch, ni
// hook — utilisable tel quel par la page serveur /offres/<slug> ET par
// l'aperçu CLIENT du formulaire recruteur (c'est tout l'objet de
// l'extraction : le même arbre JSX, deux hôtes). Seules les données arrivent
// en props, déjà chargées par l'appelant (aucune requête ici, le compteur
// « requêtes par page » de M5 reste verrouillé côté page).
//
// Parité legacy (offres/show.blade.php) — commentaire de structure repris de
// la page M5, inchangé : en-tête (logo 64 px, titre, nom d'entreprise, 4
// badges dont pays), Description (nl2br → whitespace-pre-wrap, jamais de HTML
// injecté), Compétences requises (si présentes), Offres similaires (4 max,
// lignes cliquables), colonne droite « Détails » (contrat, niveau,
// localisation, salaire FCFA si salaire_visible, dates) et « À propos de
// l'entreprise ». Libellés propres (les artefacts `stage`, ucfirst
// `Sans_experience` du blade ne sont pas portés) ; le violet badge-categorie
// n'existe pas en tokens M2 → neutre.
//
// Hors périmètre (reporté en M7) : carte de candidature (postuler,
// sauvegarder, déjà postulé, contacter le recruteur), modal de
// candidature, détection d'état auth — la fiche reste strictement passive,
// y compris dans l'aperçu recruteur (cf. `blocCandidature`).
//
// A11y : hiérarchie h1 (titre) → h2 (sections) continue ; les blocs
// d'initiales sont décoratifs (aria-hidden) — le nom de l'entreprise est
// toujours affiché à côté/dessous ; le wrapper du h2 « À propos » est un
// <div> (un <span> ne peut pas contenir de <h2> — contenu phrasing).
// ---------------------------------------------------------------------------

/**
 * Données affichées par la fiche : `OffreDetail` public élargi aux seules
 * valeurs que l'APERCÛ recruteur est en mesure de fournir AVANT validation —
 * deux écarts strictement localisés, AUCUN champ ajouté :
 *
 * - `typeContrat` / `niveauExperience` : `''` quand le select n'a pas encore
 *   été choisi (« aperçu = reflet fidèle, sans validation ») → libellé vide,
 *   exactement ce que le public ne voit jamais puisque la base exige un enum ;
 * - `salaireMin` / `salaireMax` : un nombre pur accepté en plus de `Decimal`
 *   — Prisma n'expose sa classe Decimal qu'au serveur, or l'aperçu assemble
 *   depuis des saisies de formulaire et `formatSalaire` ne fait que `Number()`.
 *
 * La page M5 passe un `OffreDetail` réel : strictement assignable, donc le
 * rendu public est inchangé.
 */
export type DonneesFiche = Omit<
  OffreDetail,
  'typeContrat' | 'niveauExperience' | 'salaireMin' | 'salaireMax'
> & {
  typeContrat: TypeContrat | ''
  niveauExperience: NiveauExperience | ''
  salaireMin: OffreDetail['salaireMin'] | number
  salaireMax: OffreDetail['salaireMax'] | number
}

export interface FicheOffreProps {
  /** Offre à afficher (page M5 : `OffreDetail` lu par la DAL publique). */
  offre: DonneesFiche
  /** Similaires déjà chargés par l'appelant — `[]` (défaut) = section masquée. */
  similaires?: OffreCarte[]
  /**
   * Bascule du bloc de candidature (M7) : la fiche publique l'affichera,
   * l'aperçu recruteur non. Prop dès maintenant (et non duplication du
   * bloc) pour que M7 n'ait qu'à le lire : la fiche du formulaire reste
   * passive sans variante de code.
   */
  blocCandidature?: boolean
}

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

export function FicheOffre({ offre, similaires = [] }: FicheOffreProps) {
  // Le public ne fournit que des enums, l'aperçu peut fournir `''` (select
  // non choisi) : on neutralise l'affichage sans toucher au reste du rendu.
  const libelleContrat =
    offre.typeContrat === '' ? '' : TYPE_CONTRAT_LABELS[offre.typeContrat]
  const libelleNiveau =
    offre.niveauExperience === ''
      ? ''
      : NIVEAU_EXPERIENCE_LABELS[offre.niveauExperience]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Colonne principale */}
      <div className="space-y-4 lg:col-span-2">
        {/* En-tête de l'offre */}
        <Card>
          <div className="flex items-start gap-3">
            {/* Décoratif (task 9) : le nom de l'entreprise suit dans
                le h1 contexte. */}
            <div
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-tint text-base font-bold text-brand-dark"
            >
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
                  {libelleContrat}
                </Badge>
                <Badge variant="warn" className="gap-1 px-3 py-2">
                  <IconMapPin size={14} />
                  {offre.ville}
                  {offre.pays !== '' ? `, ${offre.pays}` : ''}
                </Badge>
                <Badge variant="ok" className="gap-1 px-3 py-2">
                  <IconBarChart size={14} />
                  {libelleNiveau}
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
                        initiales au legacy, pas le logo image —
                        décoratif (task 9), le nom suit dans le texte. */}
                    <div
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-tint text-xs font-bold text-brand-dark"
                    >
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
          contacter) appartient à M7 : aucune logique d'état auth ici, et
          l'aperçu recruteur n'affichera jamais ce bloc (prop M7). */}
      <div className="space-y-4">
        <Card>
          <TitreSection icone={<IconInfo size={18} />}>Détails</TitreSection>
          <ul className="mt-1 divide-y divide-line">
            <LigneDetail label="Type de contrat" valeur={libelleContrat} />
            <LigneDetail label="Niveau requis" valeur={libelleNiveau} />
            <LigneDetail label="Localisation" valeur={offre.ville} />
            {offre.salaireMin !== null && offre.salaireVisible ? (
              <LigneDetail
                label="Salaire"
                className="text-ok"
                valeur={formatSalaire(offre.salaireMin, offre.salaireMax)}
              />
            ) : null}
            <LigneDetail label="Publiée le" valeur={formatDate(offre.createdAt)} />
            <LigneDetail
              label="Expire le"
              className="text-danger"
              valeur={formatDate(offre.dateExpiration)}
            />
          </ul>
        </Card>

        {/* À propos — parité stricte : initiales (pas d'image) au legacy. */}
        <Card className="text-center">
          <div className="flex">
            <TitreSection icone={<IconBuilding size={18} />}>
              À propos de l&apos;entreprise
            </TitreSection>
          </div>
          <div
            aria-hidden="true"
            className="mx-auto mt-4 flex h-[60px] w-[60px] items-center justify-center rounded-md bg-brand-tint text-base font-bold text-brand-dark"
          >
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
  )
}

// ─── Fragments locaux (dépliqués de la page M5) ──────────────────────────────

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
 * Date affichée : la page M5 ne fournit que des dates valides (sortie
 * identique à l'`Intl.format` direct), mais l'aperçu recruteur assemble
 * depuis un `<input type="date">` VIDE et sans validation — `Intl.format`
 * lèverait un RangeError qui emporterait tout le rendu. Date vide → texte
 * vide, jamais d'exception.
 */
function formatDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? '' : FORMATEUR_DATE.format(date)
}

/**
 * Parity `number_format($salaire, 0, ',', ' ') FCFA` : « 1 500 » ou
 * « 1 500 — 2 000 FCFA ». Le type Decimal de Prisma passe par Number()
 * (decimal.js valueOf → string numérique) — jamais de virgule décimale,
 * le legacy tronquait aussi à 0 décimale. L'aperçu fournit un nombre pur
 * : Number() donne le même résultat.
 */
function formatSalaire(
  min: NonNullable<DonneesFiche['salaireMin']>,
  max: DonneesFiche['salaireMax'],
): string {
  const bornes = max !== null ? ` — ${FORMATEUR_MONTANT.format(Number(max))}` : ''
  return `${FORMATEUR_MONTANT.format(Number(min))}${bornes} FCFA`
}
