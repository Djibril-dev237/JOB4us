import type { Metadata } from 'next'

import { BandeauAdmin } from '@/components/admin/bandeau-admin'
import { CarteStatistique } from '@/components/admin/carte-statistique'
import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { EtatVideAdmin } from '@/components/admin/etat-vide-admin'
import { IconBriefcase } from '@/components/icons'
import { requireAdmin } from '@/lib/dal'
import { compterOffresPourAdmin, listerOffresPourAdmin } from '@/lib/offres-admin-dal'
import { messageErreurTransition, messageMaj } from '@/lib/offres-labels'

import { LigneOffreAdmin } from './ligne-offre'

// ─── Espace admin minimal des offres (M6, Vague 2 — D5) ──────────────────────
//
// Périmètre D5 validé : stats, liste COMPLÈTE de toutes les offres vivantes
// (tous recruteurs), badges de statut et bascule Suspendre/Relever. Le
// legacy offrait en plus la recherche `q`, les filtres catégorie/statut et
// la pagination 15/page : NON PORTÉS par la décision D5 (signalé au
// rapport, coût d'un correctif estimé à une liste blanche de paramètres +
// un `where` conditionnel + un `take/skip` dans offres-admin-dal.ts).
//
// Garde : requireAdmin() AVANT toute donnée (le proxy ne fait qu'un contrôle
// optimiste sur le préfixe /admin). Pas d'`entrepriseDuCompte` :
// l'admin voit tout, c'est tout l'objet de la page.
//
// Requêtes : UNE findMany (jointures entreprise + catégorie incluses, donc
// aucune par ligne) + UNE transaction de 3 count pour les cartes de stats.
//
// Bandeaux : retours des actions serveur, résolus UNIQUEMENT via
// messageMaj() / messageErreurTransition() de @/lib/offres-labels —
// fail-closed, jamais de texte libre depuis l'URL.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Gestion des offres',
}

export default async function PageAdminOffres({
  searchParams,
}: PageProps<'/admin/offres'>) {
  await requireAdmin()

  // `searchParams` peut porter des tableaux (?maj=a&maj=b) : ces clés sont
  // alors ignorées, cohérent avec le fail-closed des deux helpers.
  const params = await searchParams
  const cleMaj = typeof params.maj === 'string' ? params.maj : undefined
  const cleErreur = typeof params.erreur === 'string' ? params.erreur : undefined
  const succes = messageMaj(cleMaj)
  const echec = messageErreurTransition(cleErreur)

  const [lignes, comptes] = await Promise.all([
    listerOffresPourAdmin(),
    compterOffresPourAdmin(),
  ])

  // Frontière d'affichage unique : badge « expirée » et dates relatives
  // partagent le même instant pour toute la liste (D12 : dérivé à lecture).
  const maintenant = new Date()

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <EnTeteAdmin
        titre="Gestion des offres"
        description={`${comptes.total} offre(s) au total`}
      />

      {succes !== null || echec !== null ? (
        <div className="flex flex-col gap-2">
          {succes !== null ? <BandeauAdmin variante="succes" message={succes} /> : null}
          {echec !== null ? <BandeauAdmin variante="erreur" message={echec} /> : null}
        </div>
      ) : null}

      {/* Stats : « Total » et « Expirées » repris tels quels du blade. Le
          legacy disait « Actives » = is_active && date >= now, concept
          supprimé par D7 (booléen is_active remplacé par la matrice de
          statuts) : le compteur est statut='publiee' SANS clause de date,
          les publiées expirées restant comptées (aucun cron, T11). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <CarteStatistique libelle="Total" valeur={comptes.total} />
        <CarteStatistique libelle="Publiées" valeur={comptes.publiees} ton="ok" />
        <CarteStatistique libelle="Expirées" valeur={comptes.expirees} ton="danger" />
      </div>

      <ul className="divide-y divide-line rounded-md border border-line bg-surface shadow-card">
        {lignes.length === 0 ? (
          <li>
            <EtatVideAdmin
              message="Aucune offre trouvée"
              icone={<IconBriefcase size={32} />}
            />
          </li>
        ) : (
          lignes.map((offre) => (
            <LigneOffreAdmin key={offre.id} offre={offre} maintenant={maintenant} />
          ))
        )}
      </ul>
    </div>
  )
}
