import type { Metadata } from 'next'

import { IconBriefcase } from '@/components/icons'
import { compterOffresPourAdmin, listerOffresPourAdmin } from '@/lib/offres-admin-dal'
import { verifyRole } from '@/lib/dal'
import { messageErreurTransition, messageMaj } from '@/lib/offres-labels'

import { Bandeau } from './bandeau'
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
// Garde : verifyRole('admin') AVANT toute donnée (le proxy ne fait qu'un
// contrôle optimiste sur le préfixe /admin). Pas d'`entrepriseDuCompte` :
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

/** Colonnes de stats, parité `.stat-mini` legacy (bloc centré clair). */
const CLASSE_STAT = 'rounded-md bg-surface-alt p-4 text-center'
const CLASSE_NOMBRE = 'text-4xl font-bold text-ink'
const CLASSE_LIBELLE = 'mt-1 text-xs font-medium text-ink-muted'

export default async function PageAdminOffres({
  searchParams,
}: PageProps<'/admin/offres'>) {
  await verifyRole('admin')

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
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Gestion des offres
      </h1>
      <p className="mt-2 text-base text-ink-muted">{comptes.total} offre(s)</p>

      {succes !== null || echec !== null ? (
        <div className="mt-4 flex flex-col gap-2">
          {succes !== null ? <Bandeau variante="succes" message={succes} /> : null}
          {echec !== null ? <Bandeau variante="erreur" message={echec} /> : null}
        </div>
      ) : null}

      {/* Stats : « Total » et « Expirées » repris tels quels du blade. Le
          legacy disait « Actives » = is_active && date >= now, concept
          supprimé par D7 (booléen is_active remplacé par la matrice de
          statuts) : le compteur est statut='publiee' SANS clause de date,
          les publiées expirées restant comptées (aucun cron, T11) — d'où
          le libellé de compteur « Publiées » (pluriel, comme la pastille
          OPTIONS_FILTRE_STATUT), pas le singulier « Publiée » du badge. */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className={CLASSE_STAT}>
          <div className={CLASSE_NOMBRE}>{comptes.total}</div>
          <div className={CLASSE_LIBELLE}>Total</div>
        </div>
        <div className={CLASSE_STAT}>
          <div className={`${CLASSE_NOMBRE} text-ok`}>{comptes.publiees}</div>
          <div className={CLASSE_LIBELLE}>Publiées</div>
        </div>
        <div className={CLASSE_STAT}>
          <div className={`${CLASSE_NOMBRE} text-danger`}>{comptes.expirees}</div>
          <div className={CLASSE_LIBELLE}>Expirées</div>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-line rounded-md border border-line bg-surface shadow-card">
        {lignes.length === 0 ? (
          // État vide, libellé exact du blade : « Aucune offre trouvée ».
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <IconBriefcase size={32} className="text-ink-muted opacity-25" />
            <p className="text-sm font-semibold text-ink-muted">
              Aucune offre trouvée
            </p>
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
