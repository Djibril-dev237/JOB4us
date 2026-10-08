import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { creerOffre } from '@/app/actions/offres'
import { buttonClassName } from '@/components/ui/button'
import { verifyRole } from '@/lib/dal'
import { dateCouranteDouala } from '@/lib/douala'
import { entrepriseDuCompte } from '@/lib/offres-dal'
import {
  entrepriseCompleteDuCompte,
  listerCategories,
  listerCompetencesCatalogue,
} from '@/lib/offres-form-dal'

import { OffreForm } from '../offre-form'

export const metadata: Metadata = {
  title: 'Publier une offre',
}

// ─── Formulaire de création d'une offre — /recruteur/offres/creer ────────────
//
// URL contractée (le proxy couche 4 whiteliste cette route en écriture) :
// l'ordre des gardes suit la doctrine M6, role d'abord — un visiteur sans
// droits ne voit JAMAIS le formulaire (redirect /unauthorized du DAL), puis
// ownership : aucun compte sans entreprise ne peut ouvrir un formulaire dont
// l'action refuserait l'écriture (`entrepriseDuCompte` = null → même 404
// qu'une offre introuvable, jamais un message distinct).
//
// Page serveur async (règle #98097 : aucun await sous loading.tsx, et aucun
// loading.tsx créé ici). Trois lectures parallèles, une par fonction —
// aucun N+1, aucune écriture sur ce GET.
//
// `min` du calendrier = demain à Douala, calculé ICI plutôt que dans l'ilot
// client : la valeur arrive en prop, donc le serveur et l'hydratation
// produisent la MÊME chaîne (aucun mismatch d'attribut dérivé de l'horloge).
// ---------------------------------------------------------------------------

/** Demain (AAAA-MM-JJ) sur le fuseau cible — parité legacy
 *  `date('Y-m-d', strtotime('+1 day'))`, sans dépendre de l'horloge du
 *  serveur applicatif (dev UTC+1 / Vercel UTC). */
function dateMinDemain(): string {
  const [annee, mois, jour] = dateCouranteDouala().split('-').map(Number)
  return new Date(Date.UTC(annee, mois - 1, jour + 1)).toISOString().slice(0, 10)
}

export default async function PageCreationOffre() {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  const [categories, competences, entreprise] = await Promise.all([
    listerCategories(),
    listerCompetencesCatalogue(),
    entrepriseCompleteDuCompte(session.userId),
  ])
  if (entreprise === null) notFound()

  return (
    <div className="max-w-6xl space-y-6">
      {/* En-tête du blade (create.blade.php) : titre, sous-titre, Retour. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Publier une offre
          </h1>
          <p className="mt-2 text-base text-ink-muted">
            Remplissez les informations de votre offre d&apos;emploi
          </p>
        </div>
        <Link href="/recruteur/offres" className={buttonClassName('secondary')}>
          Retour
        </Link>
      </div>

      <OffreForm
        action={creerOffre}
        mode="creer"
        dateMin={dateMinDemain()}
        categories={categories}
        competences={competences}
        entreprise={entreprise}
      />
    </div>
  )
}
