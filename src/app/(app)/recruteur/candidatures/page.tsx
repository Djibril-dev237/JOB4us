import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Pagination } from '@/components/candidatures/pagination'
import { IconBriefcase } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  compteursCandidaturesRecruteur,
  listerCandidaturesRecruteur,
  type CandidatureRecruteur,
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

// ─── Liste globale des candidatures reçues — /recruteur/candidatures (M7) ────
//
// URL FIXE : c'est LA cible des redirections de `changerStatutCandidature`
// (`?maj=statut` en succès, `?erreur=transition` en refus de la matrice) —
// les deux bandeaux ci-dessous se lisent donc ici, avec les helpers
// fail-closed de src/lib/candidatures-labels.ts (clé inconnue ou absente →
// aucun bandeau, jamais de texte libre repris de l'URL), classes M6 reprises
// telles quelles. `?maj=statut` est SANS message par construction :
// `MESSAGES_MAJ_CANDIDATURE` ne connaît que `envoyee`/`retiree`, donc
// `messageMajCandidature('statut')` → `null` et le retour d'une transition
// n'affiche AUCUN bandeau — le feedback est le badge à jour sur la ligne
// relue (contrat documenté dans l'action elle-même, jamais de texte inventé).
//
// Contrôles, dans l'ordre imposé (motif M6) : rôle autoritaire
// (`verifyRole('recruteur')`, même si le proxy gate déjà le préfixe
// /recruteur), puis ownership — `entrepriseDuCompte` à `null` = compte sans
// entreprise → 404 strict, jamais 403 (il n'y a rien à afficher ici).
//
// Filtre : SEULEMENT `statut` et `page` sont extraits de `searchParams` puis
// passés à `schemaFiltreCandidatures` (`.strict()` : toute autre clé — y
// compris un tableau `?statut=a&statut=b` — fait échouer le parse). Échec du
// parse → filtre ENTIÈREMENT ignoré (« Toutes », page 1) : URL corrompue =
// filtre ignoré, aucune erreur affichée, même philosophie que M6/M5.
//
// Rendu serveur async sous loading.tsx racine (spike M5 #98097) : aucun
// loading.tsx ajouté. Aucune écriture ici — seules les server actions
// (`changerStatutCandidature`) et `marquerConsultee` écrivent.
// ---------------------------------------------------------------------------

/** Parité `@section('title', 'Candidatures reçues')` du blade recruteur. */
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
}

/**
 * Ligne de la liste (composant LOCAL à la page, serveur pur) : nom, profil
 * (ou « — »), extrait de lettre, badge de statut, offre LIÉE, date relative
 * et lien « Voir » vers la fiche pleine page. La lettre complète et le CV ne
 * sortent jamais en liste (règle §2.5 du DAL).
 *
 * Responsive : `flex-wrap` + `basis-64` — sous 360 px la ligne se replie en
 * bloc compact (aucun défilement horizontal, aucune colonne imposée).
 * Statut `retiree` : opacité faible sur TOUTE la ligne (décision de rendu de
 * candidatures-labels.ts).
 */
function CarteCandidature({ candidature }: CarteCandidatureProps) {
  const retiree = candidature.statut === 'retiree'

  return (
    <Card
      className={`transition-shadow duration-fast hover:border-line-strong hover:shadow-lift${
        retiree ? ' opacity-60' : ''
      }`}
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

export default async function PageCandidaturesRecruteur({
  searchParams,
}: PageProps<'/recruteur/candidatures'>) {
  // 1. Rôle (autoritaire) puis 2. ownership — même ordre que les actions.
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  const params = await searchParams
  const bandeauSucces = messageMajCandidature(paramUnique(params.maj))
  const bandeauErreur = messageErreurCandidature(paramUnique(params.erreur))
  const filtres = filtresDepuis(params)

  // Compteurs (même jointure d'appartenance que la liste) + page courante,
  // 2 requêtes indépendantes lancées ensemble.
  const [compteurs, resultat] = await Promise.all([
    compteursCandidaturesRecruteur(session.userId),
    listerCandidaturesRecruteur(session.userId, filtres),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Candidatures reçues
        </h1>
        {/* Compteur du filtre courant (même `where` que la liste) —
            pluralisation reprise telle quelle de la liste jumelle
            /candidat/candidatures (« 1 candidature » / « N candidatures »). */}
        <p className="mt-2 text-base text-ink-muted">
          {`${resultat.total} ${resultat.total === 1 ? 'candidature' : 'candidatures'}`}
        </p>
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

      {/* Pastilles de filtre collantes sous le header (h-16, motif M6) :
          le compteur est affiché DANS le libellé (« Nouvelle (3) »), dans
          l'ordre exact OPTIONS_FILTRE_CANDIDATURE.recruteur ; « Toutes (N) »
          pointe sur le chemin NU (aucun paramètre). */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <nav aria-label="Filtrer les candidatures" className="flex flex-wrap items-center gap-2">
          {OPTIONS_FILTRE_CANDIDATURE.recruteur.map(({ valeur, libelle }) => {
            const actif = valeur === (filtres.statut ?? 'toutes')
            return (
              <Link
                key={valeur}
                href={{
                  pathname: '/recruteur/candidatures',
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
      </div>

      {resultat.items.length === 0 ? (
        /* État vide EXACT (prompt M7) — identique que le filtre soit vide,
           trop restrictif ou qu'aucune candidature n'existe encore. */
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
              <CarteCandidature candidature={candidature} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={resultat.page}
        pages={resultat.pages}
        chemin="/recruteur/candidatures"
        parametres={{ statut: filtres.statut }}
      />
    </div>
  )
}
