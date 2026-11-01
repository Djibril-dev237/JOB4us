import type { Metadata } from 'next'
import Link from 'next/link'

import { CarteStatistique } from '@/components/admin/carte-statistique'
import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { requireAdmin } from '@/lib/dal'
import {
  FENETRE_STATISTIQUES_JOURS,
  lireStatistiquesAdmin,
} from '@/lib/admin-statistiques'

// ─── Tableau de bord administrateur — /admin/dashboard (M10) ────────────────
// Toutes les valeurs viennent de `lireStatistiquesAdmin` (requêtes bornées).
// Aucun graphique, aucun cumul de vanité : l'écran sert à décider quoi traiter
// maintenant, avec des liens directs vers les files de modération.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Tableau de bord',
}

const LIENS_RAPIDES = [
  { label: 'Utilisateurs', href: '/admin/utilisateurs', description: 'Comptes et suspensions' },
  { label: 'Offres', href: '/admin/offres', description: 'Recherche et suspension' },
  { label: 'Signalements', href: '/admin/signalements', description: 'File de modération' },
  { label: "Journal d'audit", href: '/admin/audit', description: 'Traces des actions sensibles' },
  { label: 'Statistiques', href: '/admin/statistiques', description: 'Indicateurs détaillés' },
] as const

export default async function AdminDashboard() {
  await requireAdmin()
  const stats = await lireStatistiquesAdmin()

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <EnTeteAdmin
        titre="Tableau de bord"
        description="Vue opérationnelle de la plateforme. Les fenêtres d’activité portent sur les 30 derniers jours."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
      </div>

      <section aria-labelledby="acces-rapides" className="space-y-3">
        <h2 id="acces-rapides" className="text-base font-bold text-ink">
          Accès rapides
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIENS_RAPIDES.map((lien) => (
            <li key={lien.href}>
              <Link
                href={lien.href}
                className="block rounded-md border border-line bg-surface p-4 shadow-card transition-colors duration-fast hover:border-brand hover:bg-surface-alt"
              >
                <span className="block text-sm font-semibold text-brand-dark">
                  {lien.label}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {lien.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="etat-moderation" className="space-y-3">
        <h2 id="etat-moderation" className="text-base font-bold text-ink">
          État de la modération
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
      </section>
    </div>
  )
}
