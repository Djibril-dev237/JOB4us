import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { IconBriefcase } from '@/components/icons'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { verifyRole } from '@/lib/dal'
import { entrepriseDuCompte, listerOffresGestion } from '@/lib/offres-dal'
import {
  OPTIONS_FILTRE_STATUT,
  VALEURS_FILTRE_STATUT,
  messageErreurTransition,
  messageMaj,
  type ValeurFiltreStatut,
} from '@/lib/offres-labels'

import { CarteOffre } from './carte-offre'

// ─── Dashboard de gestion des offres recruteur (M6, mission 2B) ──────────────
//
// URL FIXE /recruteur/offres : c'est LA cible de toutes les redirections des
// actions recruteur (`?maj=<cle>` en succès, `?erreur=<cle>` en refus de la
// matrice T1-T11) — les deux bandeaux ci-dessous se lisent donc ici ; l'espace
// admin lit les siens sur /admin/offres pour T8/T9, avec les MÊMES helpers
// fail-closed : clé inconnue ou absente → aucun bandeau, jamais de texte
// libre repris de l'URL.
//
// Contrôles, dans l'ordre imposé : rôle (garde autoritaire, même si le proxy
// couche 4 gate déjà le préfixe /recruteur), puis ownership (`null` → 404,
// jamais de 403 : un compte sans entreprise n'a rien à afficher ici).
//
// Filtre `?statut=` : validé contre VALEURS_FILTRE_STATUT, toute valeur
// incohérente retombe sur '' (« Toutes ») SANS erreur — même philosophie que
// les filtres de la liste publique M5 (URL corrompue = filtre ignoré).
//
// Rendu serveur async sous loading.tsx racine : le spike M5 (#98097) a conclu
// que la suspension n'est pas reproduite sur next 16.3.6 — règle documentée,
// aucun loading.tsx ajouté.
//
// Parité legacy (index.blade.php) : titre, sous-titre, état vide exact,
// tri par création décroissante (DAL). Le legacy paginait (10/page) : non
// porté en M6 (décision documentée dans le rapport — volume borné par
// compte, D4/D6), donc aucun composant de pagination ici.
// ---------------------------------------------------------------------------

/** Parité `@section('title', 'Mes offres')` du blade. */
export const metadata: Metadata = {
  title: 'Mes offres',
}

/** Bandeau de succès `?maj=` (tokens M2, motif ALERTE_SUCCES de l'espace recruteur). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus `?erreur=` (tokens M2, motif ALERTE_ERREUR). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/** Pastille de filtre active (libellés exactes OPTIONS_FILTRE_STATUT). */
const CLASSE_PASTILLE_ACTIVE =
  'inline-flex h-9 items-center rounded-full border border-brand bg-brand px-3 text-sm font-medium text-white'

const CLASSE_PASTILLE =
  'inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink'

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?maj=a&maj=b` (tableau)
 * n'a pas de sens : passé à `null`, les helpers ne rendent rien.
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

export default async function PageOffresRecruteur({
  searchParams,
}: PageProps<'/recruteur/offres'>) {
  // 1. Rôle (autoritaire) puis 2. ownership — même ordre que les actions.
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  const params = await searchParams
  const brut = paramUnique(params.statut)
  const filtre: ValeurFiltreStatut = VALEURS_FILTRE_STATUT.find((valeur) => valeur === brut) ?? ''

  const offres = await listerOffresGestion(entrepriseId, filtre)
  const bandeauSucces = messageMaj(paramUnique(params.maj))
  const bandeauErreur = messageErreurTransition(paramUnique(params.erreur))

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Mes offres d&apos;emploi
        </h1>
        <p className="mt-2 text-base text-ink-muted">
          Gérez vos offres publiées sur Job4Us
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

      {/* D9 : barre d'actions collante sous le header (h-16, z-40) — les
          pastilles de filtre et le bouton de création restent atteignables
          en défilant, sans masquer le contenu (élément du flux, pas en
          position fixe) et sans espace réservé au défilement horizontal. */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Filtrer les offres" className="flex flex-wrap items-center gap-2">
            {OPTIONS_FILTRE_STATUT.map(({ valeur, libelle }) => {
              const actif = valeur === filtre
              return (
                <Link
                  key={valeur === '' ? 'toutes' : valeur}
                  href={{ pathname: '/recruteur/offres', query: valeur ? { statut: valeur } : {} }}
                  aria-current={actif ? 'page' : undefined}
                  className={actif ? CLASSE_PASTILLE_ACTIVE : CLASSE_PASTILLE}
                >
                  {libelle}
                </Link>
              )
            })}
          </nav>

          <Link href="/recruteur/offres/creer" className={buttonClassName('primary')}>
            Publier une offre
          </Link>
        </div>
      </div>

      {offres.length === 0 ? (
        /* État vide EXACT du blade (@forelse/@empty) — identique que le
           filtre soit vide ou qu'aucune offre n'existe encore. */
        <Card className="text-center">
          <div className="py-8">
            <IconBriefcase size={40} className="mx-auto text-brand opacity-25" />
            <div className="mt-4 text-sm font-medium text-ink">Aucune offre publiée</div>
            <div className="mt-1 text-sm text-ink-muted">
              Commencez à publier des offres pour trouver vos talents
            </div>
            <Link href="/recruteur/offres/creer" className={`${buttonClassName('primary')} mt-4`}>
              Publier ma première offre
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {offres.map((offre) => (
            <li key={offre.id}>
              <CarteOffre offre={offre} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
