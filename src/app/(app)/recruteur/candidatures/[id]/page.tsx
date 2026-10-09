import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { marquerConsultee } from '@/app/actions/candidatures'
import { buttonClassName } from '@/components/ui/button'
import { detailCandidatureRecruteur } from '@/lib/candidatures-dal'
import { messageErreurCandidature, messageMajCandidature } from '@/lib/candidatures-labels'
import { verifyRole } from '@/lib/dal'
import { entrepriseDuCompte } from '@/lib/offres-dal'

import { PanneauCandidature } from '../panneau-candidature'

// ─── Fiche pleine page d'une candidature — /recruteur/candidatures/[id] (M7) ──
//
// Contrôles dans l'ordre imposé (motif M6) : 1) rôle autoritaire
// (`verifyRole('recruteur')`), 2) ownership du compte (`entrepriseDuCompte`
// → `null` = 404), 3) id strict (regex `^[1-9][0-9]*$`, motif
// `idOffreDepuis` : id invalide = LE MÊME 404 qu'une ligne absente, jamais
// 400), 4) `detailCandidatureRecruteur(userId, id)` — la jointure
// `offre → entreprise → userId` EST dans le `where` du DAL : `null` = ligne
// inexistante OU candidature d'UN AUTRE recruteur, strictement
// indiscernables → 404, jamais 403, jamais de branche « pas la vôtre ».
//
// Auto-consultation BEST-EFFORT (M7) : `marquerConsultee(id)` est appelée
// APRÈS ce contrôle d'appartenance (aucune écriture sur une ligne étrangère)
// et de façon best-effort — l'échec de ce marqueur (passage
// « Envoyée → Consultée ») ne doit pas faire échouer l'affichage de la
// fiche : c'est un état secondaire, pas une donnée que le recruteur peut
// réparer. Aucune AUTRE écriture dans cette page (aucun appel Prisma direct).
//
// Les bandeaux `?maj=` / `?erreur=` se lisent aussi ici : l'action
// `changerStatutCandidature` redirige vers la liste globale, mais une URL
// partagée ou un retour du navigateur peut reconstruire ce chemin avec ces
// paramètres — helpers fail-closed, classes M6.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Candidatures reçues',
}

/** Bandeau de succès `?maj=` (tokens M2, motif ALERTE_SUCCES de M6). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus `?erreur=` (tokens M2, motif ALERTE_ERREUR de M6). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/** Entier strict positif, id de candidature (motif `idOffreDepuis`). */
const STRICT_POSITIVE_INT = /^[1-9][0-9]*$/

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?maj=a&maj=b` (tableau)
 * n'a aucun sens : passé à `null`, les helpers ne rendent rien.
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

export default async function PageCandidatureRecruteur({
  params,
  searchParams,
}: PageProps<'/recruteur/candidatures/[id]'>) {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  const { id } = await params
  if (!STRICT_POSITIVE_INT.test(id)) notFound()
  const candidatureId = Number(id)

  // Existence + appartenance dans LE MÊME `where` du DAL → `null` = 404.
  const candidature = await detailCandidatureRecruteur(session.userId, candidatureId)
  if (candidature === null) notFound()

  // Auto-consultation BEST-EFFORT, strictement APRÈS le contrôle ci-dessus
  // (jamais sur une ligne étrangère). L'action absorbe déjà ses propres
  // erreurs (try/catch interne) ; le garde ci-dessous pose AUSSI au niveau
  // du rendu le contrat « un marqueur qui ne bouge pas ne fait jamais
  // échouer la fiche » — aucun `console.*`, aucun bandeau.
  try {
    await marquerConsultee(candidatureId)
  } catch {
    // Silencieux assumé — best-effort : rien à réparer côté recruteur.
  }

  const paramsRecherche = await searchParams
  const bandeauSucces = messageMajCandidature(paramUnique(paramsRecherche.maj))
  const bandeauErreur = messageErreurCandidature(paramUnique(paramsRecherche.erreur))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Candidatures reçues
        </h1>

        {/* Navigation de sortie : retour à la liste globale, ou liste des
            candidatures de L'OFFRE qui emploie ce candidat. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/recruteur/candidatures" className={buttonClassName('secondary', 'sm')}>
            Retour à la liste
          </Link>
          <Link
            href={`/recruteur/offres/${candidature.offre.id}/candidatures`}
            className={buttonClassName('secondary', 'sm')}
          >
            Candidatures de cette offre
          </Link>
        </div>
      </div>

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

      {/* Même fiche que le panneau collant de la liste par offre, ici en
          pleine largeur de la colonne (max-w-3xl). */}
      <PanneauCandidature candidature={candidature} />
    </div>
  )
}
