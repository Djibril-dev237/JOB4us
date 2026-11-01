import type { Metadata } from 'next'
import type { StatutSignalement } from '@prisma/client'

import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { EtatVideAdmin } from '@/components/admin/etat-vide-admin'
import { FiltresAdmin } from '@/components/admin/filtres-admin'
import { Pagination } from '@/components/candidatures/pagination'
import { IconFlag } from '@/components/icons'
import { requireAdmin } from '@/lib/dal'
import { TEXTES } from '@/lib/messagerie-labels'
import { prisma } from '@/lib/prisma'

import { LigneSignalement, type SignalementLigne } from './ligne-signalement'

// ─── File de modération — /admin/signalements (M8, Vague 3, SA-8) ────────────
//
// Legacy n'avait AUCUNE vue de modération : ces écrans suivent le patron des
// pages admin existantes (M6/M7), pas un ancêtre PHP.
//
// Contrôles, dans l'ordre imposé (motif M6/M7) :
//   1) garde autoritaire `requireAdmin()` AVANT toute lecture (le proxy ne
//      fait qu'un contrôle optimiste sur le préfixe /admin) ;
//   2) `?statut=` : SEULE `traite` est reconnue (toute autre valeur ou
//      paramètre répété = « ouverts », défaut) — fail-closed, comme le
//      `?filtre=` de /messages ;
//   3) `?page=` : patron de pagination M7 (15/page, composant partagé
//      `Pagination`, `pageCourante` identique à candidatures-dal) — le
//      comptage est le `count` du MÊME `where` que la liste (« même
//      comptage » : le total décrit le filtre courant, jamais l'ensemble).
//
// Requêtes : UNE findMany (auteur + message inclus, donc aucune par ligne)
// + UN count, lancées ensemble. AUCUNE action dans la liste : la clôture
// vit uniquement dans le détail (page serveur + formulaire client dédié).
//
// Tous les textes affichés sortent de TEXTES (aucun libellé local) ; les
// dates sont Intl fr-FR figées sur Africa/Douala (motif M6). Rendu serveur
// async : règle du spike #98097 — aucun loading.tsx.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: TEXTES.titreSignalements,
}

/** Parité M7 : 15 lignes par page (CANDIDATURES_PAR_PAGE, même rythme). */
const SIGNALEMENTS_PAR_PAGE = 15

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?statut=a&statut=b`
 * (tableau) n'a aucun sens : passé à `null`, le filtre retombe sur le
 * défaut (motif M6/M7 repris à l'identique).
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

/**
 * Page demandée ramenée dans les bornes : défaut 1, strictement entière,
 * `Math.max(1, …)` — page 0, négative ou NaN valent page 1 (donc skip 0).
 * Aucun PLAFONNEMENT à `pages` : une URL partagée périmée renvoie une page
 * vide plutôt que d'être réécrite silencieusement (motif du DAL M7).
 */
function pageCourante(pageDemandee: string | null): number {
  const entier = Math.trunc(Number(pageDemandee ?? 1))
  return Number.isFinite(entier) ? Math.max(1, entier) : 1
}

export default async function PageSignalements({
  searchParams,
}: PageProps<'/admin/signalements'>) {
  // 1. Garde admin stricte : visiteur/non-admin reçoit le 404 du DAL.
  await requireAdmin()

  // 2. Filtre : `?statut=traite` seul, tout le reste vaut « ouverts ».
  const params = await searchParams
  const filtre: StatutSignalement =
    paramUnique(params.statut) === 'traite' ? 'traite' : 'ouvert'
  const page = pageCourante(paramUnique(params.page))

  // 3. Liste + comptage du MÊME where, lancés ensemble (2 requêtes fixes).
  const [total, lignes] = await Promise.all([
    prisma.signalement.count({ where: { statut: filtre } }),
    prisma.signalement.findMany({
      where: { statut: filtre },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * SIGNALEMENTS_PAR_PAGE,
      take: SIGNALEMENTS_PAR_PAGE,
      // Aucune jointure par ligne et AUCUN contenu de message : la file ne
      // montre que les métadonnées du signalement (M10).
      select: {
        id: true,
        motif: true,
        statut: true,
        createdAt: true,
        auteur: { select: { name: true } },
      },
    }),
  ])
  const pages = Math.max(1, Math.ceil(total / SIGNALEMENTS_PAR_PAGE))

  const lignesAffichees: SignalementLigne[] = lignes.map((ligne) => ({
    id: ligne.id,
    motif: ligne.motif,
    statut: ligne.statut,
    createdAt: ligne.createdAt,
    auteurNom: ligne.auteur.name,
  }))

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <EnTeteAdmin
        titre={TEXTES.titreSignalements}
        description="File de modération : les contenus privés ne sont consultables qu’après une décision d’accès tracée."
      />

      <FiltresAdmin
        ariaLabel="Filtrer les signalements"
        items={[
          {
            label: TEXTES.filtreOuverts,
            href: '/admin/signalements',
            actif: filtre === 'ouvert',
          },
          {
            label: TEXTES.filtreTraites,
            href: '/admin/signalements?statut=traite',
            actif: filtre === 'traite',
          },
        ]}
      />

      <ul className="divide-y divide-line rounded-md border border-line bg-surface shadow-card">
        {lignesAffichees.length === 0 ? (
          <li>
            <EtatVideAdmin
              message={TEXTES.listeSignalementsVide}
              icone={<IconFlag size={32} />}
            />
          </li>
        ) : (
          lignesAffichees.map((signalement) => (
            <LigneSignalement key={signalement.id} signalement={signalement} />
          ))
        )}
      </ul>

      {/* Pagination M7 : le filtre courant est conservé dans chaque lien ;
          « ouverts » est le défaut canonique donc OMIS (URL nu). */}
      <Pagination
        page={page}
        pages={pages}
        chemin="/admin/signalements"
        parametres={filtre === 'traite' ? { statut: 'traite' } : undefined}
        ariaLabel={TEXTES.pagination}
      />
    </div>
  )
}
