import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { marquerConsultee } from '@/app/actions/candidatures'
import { Pagination } from '@/components/candidatures/pagination'
import { IconBriefcase } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  compteursCandidaturesRecruteur,
  detailCandidatureRecruteur,
  listerCandidaturesOffre,
  type CandidatureRecruteur,
  type CandidatureRecruteurDetail,
  type FiltresCandidatures,
} from '@/lib/candidatures-dal'
import {
  LIBELLES_STATUT,
  OPTIONS_FILTRE_CANDIDATURE,
  VARIANTE_STATUT,
  messageErreurCandidature,
  messageMajCandidature,
} from '@/lib/candidatures-labels'
import { schemaFiltreCandidatures } from '@/lib/candidatures-schemas'
import { verifyRole } from '@/lib/dal'
import { dateRelativeFr } from '@/lib/dates'
import { entrepriseDuCompte } from '@/lib/offres-dal'
import { prisma } from '@/lib/prisma'

import { PanneauCandidature } from '../../../candidatures/panneau-candidature'

// ─── Candidatures d'UNE offre + panneau collant — /recruteur/offres/[id]/candidatures ──
//
// MÊME rendu que la liste globale (bandeaux, pastilles avec compteurs, cartes,
// pagination), plus la lecture d'une fiche en panneau à droite.
//
// Contrôles dans l'ordre imposé : rôle (`verifyRole('recruteur')`) →
// ownership du compte (`entrepriseDuCompte` → `null` = 404) → id d'offre
// strict (regex `^[1-9][0-9]*$`, motif `idOffreDepuis` : id non numérique,
// nul ou avec zéro initial = LE MÊME 404 qu'une offre absente, jamais 400).
//
// CRITÈRE M7 : recruteur HORS de ses offres = 404 STRICT.
// `listerCandidaturesOffre(userId, offreId, …)` renvoie `null` quand l'offre
// n'existe pas OU qu'elle appartient à un autre compte — les deux cas sont
// strictement indiscernables (le `where` du DAL croise `id` + la jointure
// `entreprise.userId`) et deviennent tous deux `notFound()` : aucun 403, qui
// révélerait l'existence des lignes d'autrui. La possession est donc posée
// DANS la requête de lecture, jamais « lue puis vérifiée ».
//
// Panneau collant (>= 1024 px) : `?candidature=<id>` — regex stricte, sinon
// le paramètre est IGNORE (aucune erreur d'URL) ; la fiche relue par le DAL
// (`null` → 404, même indiscernabilité) puis `marquerConsultee` en
// best-effort APRÈS ce contrôle d'appartenance. Aucune écriture Prisma
// directe dans cette page.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Candidatures reçues',
}

/** Bandeau de succès `?maj=` (tokens M2, motif ALERTE_SUCCES de M6). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus `?erreur=` (tokens M2, motif ALERTE_ERREUR de M6). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/** Pastille de filtre active (libellés OPTIONS_FILTRE_CANDIDATURE.recruteur). */
const CLASSE_PASTILLE_ACTIVE =
  'inline-flex h-9 items-center rounded-full border border-brand bg-brand px-3 text-sm font-medium text-white'

const CLASSE_PASTILLE =
  'inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink'

/** Entier strict positif, id d'offre ET id de candidature (motif `idOffreDepuis`). */
const STRICT_POSITIVE_INT = /^[1-9][0-9]*$/

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?maj=a&maj=b` (tableau)
 * n'a aucun sens : passé à `null`, les helpers ne rendent rien.
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

/**
 * Filtres de liste : `statut` + `page` extraits AVANT le safeParse (schéma
 * `.strict()` : un paramètre étranger comme `?maj=` ferait échouer le parse
 * s'il était passé tel quel). `null` (paramètre répété) vaut paramètre
 * ABSENT ; échec → filtre ENTIER ignoré, sans erreur (URL corrompue =
 * filtre ignoré, motif M6), exprimé exactement comme la liste jumelle
 * /candidat/candidatures.
 */
function filtresDepuis(params: Record<string, string | string[] | undefined>): FiltresCandidatures {
  const analyse = schemaFiltreCandidatures.safeParse({
    statut: paramUnique(params.statut) ?? undefined,
    page: paramUnique(params.page) ?? undefined,
  })
  return analyse.success ? analyse.data : {}
}

interface CarteCandidatureProps {
  candidature: CandidatureRecruteur
  /** Ligne correspondant au panneau ouvert : anneau `ring-1 ring-brand`. */
  selectionnee: boolean
}

/**
 * Ligne de la liste (composant LOCAL à la page, serveur pur) : reprise
 * exacte de la carte de /recruteur/candidatures + l'anneau de sélection du
 * panneau. `flex-wrap` + `basis-64` : bloc compact sous 360 px, aucun
 * défilement horizontal.
 */
function CarteCandidature({ candidature, selectionnee }: CarteCandidatureProps) {
  const retiree = candidature.statut === 'retiree'

  return (
    <Card
      className={`transition-shadow duration-fast hover:border-line-strong hover:shadow-lift${
        retiree ? ' opacity-60' : ''
      }${selectionnee ? ' ring-1 ring-brand' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            {/* h2 : hiérarchie continue depuis le h1 de la page (motif M6). */}
            <h2 className="break-words text-sm font-bold text-ink">
              {candidature.candidat.nom}
            </h2>
            <Badge variant={VARIANTE_STATUT[candidature.statut]}>
              {LIBELLES_STATUT[candidature.statut]}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-ink-muted">
            {candidature.candidat.titreProfil ?? '—'}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <Link
              href={`/recruteur/offres/${candidature.offre.id}/candidatures`}
              className="break-words font-medium text-ink transition-colors duration-fast hover:text-brand"
            >
              {candidature.offre.titre}
            </Link>
            <span aria-hidden="true">·</span>
            <time dateTime={candidature.createdAt.toISOString()}>
              {dateRelativeFr(candidature.createdAt)}
            </time>
          </p>

          {candidature.lettreExtrait !== null ? (
            <p className="mt-2 break-words rounded-sm bg-surface-alt p-2 text-sm text-ink-muted">
              {candidature.lettreExtrait}
            </p>
          ) : null}
        </div>

        <Link
          href={`/recruteur/candidatures/${candidature.id}`}
          className={buttonClassName('secondary', 'sm')}
        >
          Voir
        </Link>
      </div>
    </Card>
  )
}

export default async function PageCandidaturesOffre({
  params,
  searchParams,
}: PageProps<'/recruteur/offres/[id]/candidatures'>) {
  // 1. Rôle (autoritaire) puis 2. ownership du compte — motif M6.
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  // 3. id d'offre : regex stricte, sinon LE MÊME 404 qu'une offre absente.
  const { id } = await params
  if (!STRICT_POSITIVE_INT.test(id)) notFound()
  const offreId = Number(id)

  const search = await searchParams
  const bandeauSucces = messageMajCandidature(paramUnique(search.maj))
  const bandeauErreur = messageErreurCandidature(paramUnique(search.erreur))
  const filtres = filtresDepuis(search)

  const [resultat, compteurs, offre] = await Promise.all([
    // Critère M7 : `null` = offre inexistante OU offre d'un AUTRE recruteur,
    // indiscernables → 404 strict (jamais 403, jamais de liste vide qui
    // laisserait croire que l'offre existe sans candidature).
    listerCandidaturesOffre(session.userId, offreId, filtres),
    compteursCandidaturesRecruteur(session.userId),
    // Sous-titre = titre de l'offre : LECTURE scopée par la même jointure
    // d'appartenance (aucune écriture, aucun select au-delà du titre).
    prisma.offre.findUnique({
      where: { id: offreId, entreprise: { userId: session.userId } },
      select: { titre: true },
    }),
  ])

  if (resultat === null) notFound()
  if (offre === null) notFound()

  // Panneau ouvert ? `?candidature=<id>` : regex stricte SINON IGNORÉ (une
  // URL corrompue ne provoque ni erreur ni 404, la liste reste consultable).
  const brutCandidature = paramUnique(search.candidature)
  const candidatureOuverte =
    brutCandidature !== null && STRICT_POSITIVE_INT.test(brutCandidature)
      ? Number(brutCandidature)
      : null

  let panneau: CandidatureRecruteurDetail | null = null
  if (candidatureOuverte !== null) {
    // Contrôle d'appartenance DANS la requête du DAL (même indiscernabilité
    // que pour l'offre) → `null` = 404 strict, avant toute autre écriture.
    const detail = await detailCandidatureRecruteur(session.userId, candidatureOuverte)
    if (detail === null) notFound()
    // Revue M7 (P3-8) : cette page ne montre QUE ses propres lignes. Une
    // candidature d'une autre offre du MÊME compte passe le contrôle du DAL
    // (périmètre = entreprise) mais sortirait de la liste affichée : mêmes
    // symptômes que la ligne inexistante (404 strict, aucun écart).
    if (detail.offre.id !== offreId) notFound()
    panneau = detail

    // Auto-consultation BEST-EFFORT (M7) : appelée UNIQUEMENT quand un
    // panneau est ouvert et APRÈS le contrôle d'appartenance du DAL —
    // jamais sur une ligne qui n'est pas à ce recruteur. L'action absorbe
    // déjà ses propres erreurs (try/catch interne) ; le garde ci-dessous
    // pose AUSSI au niveau du rendu le contrat « un marqueur qui ne bouge
    // pas ne fait jamais échouer la page » (aucun `console.*`, aucun
    // bandeau : fail-closed).
    try {
      await marquerConsultee(detail.id)
    } catch {
      // Silencieux assumé — best-effort : rien à réparer côté recruteur.
    }
  }

  const chemin = `/recruteur/offres/${offreId}/candidatures`

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Candidatures reçues
        </h1>
        <p className="mt-2 text-base text-ink-muted">{offre.titre}</p>
      </div>

      {/* Bandeaux de retour : en haut de liste, jamais de texte libre. */}
      {bandeauSucces !== null ? (
        <p role="status" className={CLASSE_SUCCES}>
          {bandeauSucces}
        </p>
      ) : null}
      {bandeauErreur !== null ? (
        <p role="alert" className={CLASSE_ERREUR}>
          {bandeauErreur}
        </p>
      ) : null}

      {/* Colonne liste (2/3) + panneau collant (1/3) au-delà de 1024 px.
          `minmax(0, …)` des deux côtés : la colonne ne peut pas imposer sa
          largeur min-content, donc aucun débordement horizontal (360/768).
          Sous lg, l'aside est masqué (`hidden lg:block`) — la liste occupe
          alors la pleine largeur et la fiche reste atteignable par « Voir ». */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {/* Pastilles de filtre avec compteurs (ordre exact
              OPTIONS_FILTRE_CANDIDATURE.recruteur) ; « Toutes (N) » = chemin
              nu, les autres conservent `statut`. */}
          <nav
            aria-label="Filtrer les candidatures"
            className="flex flex-wrap items-center gap-2 border-b border-line pb-3"
          >
            {OPTIONS_FILTRE_CANDIDATURE.recruteur.map(({ valeur, libelle }) => {
              const actif = valeur === (filtres.statut ?? 'toutes')
              return (
                <Link
                  key={valeur}
                  href={{
                    pathname: chemin,
                    query: valeur === 'toutes' ? {} : { statut: valeur },
                  }}
                  aria-current={actif ? 'page' : undefined}
                  className={actif ? CLASSE_PASTILLE_ACTIVE : CLASSE_PASTILLE}
                >
                  {`${libelle} (${compteurs[valeur]})`}
                </Link>
              )
            })}
          </nav>

          {resultat.items.length === 0 ? (
            /* État vide EXACT (prompt M7). */
            <Card className="text-center">
              <div className="py-8">
                <IconBriefcase size={40} className="mx-auto text-brand opacity-25" />
                <div className="mt-4 text-sm font-medium text-ink">
                  Aucune candidature reçue pour le moment.
                </div>
                <div className="mt-1 text-sm text-ink-muted">
                  Les candidatures déposées sur vos offres apparaîtront ici.
                </div>
              </div>
            </Card>
          ) : (
            <ul className="space-y-3">
              {resultat.items.map((candidature) => (
                <li key={candidature.id}>
                  <CarteCandidature
                    candidature={candidature}
                    selectionnee={panneau?.id === candidature.id}
                  />
                </li>
              ))}
            </ul>
          )}

          {/* Aucun `offreId` dans les paramètres (P3-9 revue M7) : la route
              porte déjà l'offre, répéter le paramètre produirait un mort —
              et `schemaFiltreCandidatures.offreId` n'a aucun consommateur. */}
          <Pagination
            page={resultat.page}
            pages={resultat.pages}
            chemin={chemin}
            parametres={{ statut: filtres.statut }}
          />
        </div>

        {panneau !== null ? (
          <aside className="hidden lg:block">
            {/* `sticky top-20` : sous le header de 4rem, avec 1rem d'air.
                L'aside étant étiré sur toute la hauteur de rangée (stretch
                par défaut de la grille), le panneau suit le défilement de la
                liste jusqu'au bas de celle-ci. */}
            <div className="sticky top-20">
              <PanneauCandidature candidature={panneau} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
