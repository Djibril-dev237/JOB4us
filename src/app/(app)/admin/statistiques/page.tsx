import type { Metadata } from 'next'

import { CarteStatistique } from '@/components/admin/carte-statistique'
import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { requireAdmin } from '@/lib/dal'
import {
  FENETRE_STATISTIQUES_JOURS,
  lireStatistiquesAdmin,
} from '@/lib/admin-statistiques'

// ─── Statistiques — /admin/statistiques (M10) ───────────────────────────────
// Huit indicateurs bornés, chacun issu d'une requête réelle. Aucun graphique,
// aucun cumul de vanité : la page répond à « que se passe-t-il maintenant ? ».
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Statistiques',
}

export default async function PageAdminStatistiques() {
  await requireAdmin()
  const stats = await lireStatistiquesAdmin()

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <EnTeteAdmin
        titre="Statistiques"
        description={`Indicateurs calculés à la lecture. Les fenêtres d’activité portent sur les ${FENETRE_STATISTIQUES_JOURS} derniers jours.`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CarteStatistique
          libelle="Offres actives"
          valeur={stats.offresActives}
          detail="Publiées et non expirées"
          ton="ok"
        />
        <CarteStatistique
          libelle="Candidatures"
          valeur={stats.candidatures30Jours}
          detail={`Sur ${FENETRE_STATISTIQUES_JOURS} jours`}
        />
        <CarteStatistique
          libelle="Nouveaux comptes"
          valeur={stats.comptes30Jours}
          detail={`Sur ${FENETRE_STATISTIQUES_JOURS} jours`}
        />
        <CarteStatistique
          libelle="Signalements ouverts"
          valeur={stats.signalementsOuverts}
          detail={
            stats.signalementPlusAncienJours === null
              ? 'Aucun signalement en attente'
              : `Le plus ancien : ${stats.signalementPlusAncienJours} jour(s)`
          }
          ton={stats.signalementsOuverts > 0 ? 'attention' : 'neutre'}
        />
        <CarteStatistique
          libelle="Délai moyen de traitement"
          valeur={
            stats.delaiMoyenTraitementHeures === null
              ? 'N/A'
              : `${stats.delaiMoyenTraitementHeures} h`
          }
          detail={`Signalements traités sur ${FENETRE_STATISTIQUES_JOURS} jours`}
        />
        <CarteStatistique
          libelle="Comptes suspendus"
          valeur={stats.comptesSuspendus}
          detail="Hors comptes administrateurs"
          ton={stats.comptesSuspendus > 0 ? 'danger' : 'neutre'}
        />
        <CarteStatistique
          libelle="Offres suspendues"
          valeur={stats.offresSuspendues}
          detail="Offres non supprimées"
          ton={stats.offresSuspendues > 0 ? 'danger' : 'neutre'}
        />
      </div>

      <p className="text-xs text-ink-muted">
        Une offre est active lorsqu’elle est publiée et que sa date d’expiration
        n’est pas dépassée à Douala. Les comptes administrateurs ne peuvent pas
        être suspendus.
      </p>
    </div>
  )
}
