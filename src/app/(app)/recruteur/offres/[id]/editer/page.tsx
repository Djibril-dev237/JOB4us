import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { enregistrerModificationsOffre } from '@/app/actions/offres'
import { buttonClassName } from '@/components/ui/button'
import { StatutBadge } from '@/components/offres/statut-badge'
import { verifyRole } from '@/lib/dal'
import { entrepriseDuCompte, lireOffreModifiable } from '@/lib/offres-dal'
import { statutAffiche } from '@/lib/offres-labels'
import {
  entrepriseCompleteDuCompte,
  listerCategories,
  listerCompetencesCatalogue,
} from '@/lib/offres-form-dal'

import { OffreForm } from '../../offre-form'
import { offreEnValeurs } from '../../valeurs-offre'

export const metadata: Metadata = {
  // Parité `@section('title', 'Modifier une offre')` du blade edit — le h1
  // de la page, lui, reste « Modifier l'offre ».
  title: 'Modifier une offre',
}

// ─── Formulaire d'édition d'une offre — /recruteur/offres/<id>/editer ────────
//
// Doctrine 404 M6, dans l'ordre imposé : rôle (`verifyRole('recruteur')`),
// puis ownership (`entrepriseDuCompte` → `lireOffreModifiable`), et `null`
// à N'IMPORTE QUELLE étape = notFound() — offre inexistante, offre d'un
// autre recruteur, offre supprimée : 404 STRICTEMENT IDENTIQUE, aucun code
// ni message distinct (jamais de 403 : il révélerait l'existence). L'URL est
// de plus contrôlée par le proxy couche 4 — le notFound() de la page reste
// la défense en profondeur (fenêtre de course documentée dans partage.md).
//
// Le formulaire reçoit UNIQUEMENT des valeurs de champ + l'id (T3 : statut
// et entrepriseId ne changent pas et ne transitent pas ; slug jamais, le
// titre corrigé ne déclenche aucun UPDATE de masse). Pré-remplissage converti
// côté serveur par `offreEnValeurs` (date → AAAA-MM-JJ, Decimal → clair,
// compétences cochées ∩ catalogue affiché).
// ---------------------------------------------------------------------------

export default async function PageEditionOffre({
  params,
}: PageProps<'/recruteur/offres/[id]/editer'>) {
  const session = await verifyRole('recruteur')

  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) notFound()

  // id non numérique ou nul → le MÊME 404 qu'une offre absente (le proxy a
  // déjà tranché sur l'URL ; cette page ne produit aucune erreur 400).
  const { id } = await params
  if (!/^\d+$/.test(id) || Number(id) < 1) notFound()
  const offreId = Number(id)

  const offre = await lireOffreModifiable(offreId, entrepriseId)
  if (offre === null) notFound()

  const [categories, competences, entreprise] = await Promise.all([
    listerCategories(),
    listerCompetencesCatalogue(),
    entrepriseCompleteDuCompte(session.userId),
  ])
  if (entreprise === null) notFound()

  const valeurs = offreEnValeurs(
    offre,
    competences.map((competence) => competence.id),
  )

  return (
    <div className="max-w-6xl space-y-6">
      {/* En-tête du blade (edit.blade.php) : titre, sous-titre = titre de
          l'offre + badge de statut (D7 : remplace l'ancienne case
          is_active — l'information vient du même moteur que le dashboard). */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Modifier l&apos;offre
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-base text-ink-muted">{offre.titre}</p>
            <StatutBadge statut={statutAffiche(offre)} />
          </div>
        </div>
        <Link href="/recruteur/offres" className={buttonClassName('secondary')}>
          Retour
        </Link>
      </div>

      <OffreForm
        action={enregistrerModificationsOffre}
        mode="editer"
        idOffre={offreId}
        categories={categories}
        competences={competences}
        entreprise={entreprise}
        valeursInitiales={valeurs}
      />
    </div>
  )
}
