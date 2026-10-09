import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CarteCandidature } from '@/components/candidatures/carte-candidature'
import { Pagination } from '@/components/candidatures/pagination'
import { IconBriefcase } from '@/components/icons'
import { Card } from '@/components/ui/card'
import {
  listerCandidaturesCandidat,
  type FiltresCandidatures,
} from '@/lib/candidatures-dal'
import {
  OPTIONS_FILTRE_CANDIDATURE,
  messageErreurCandidature,
  messageMajCandidature,
} from '@/lib/candidatures-labels'
import { schemaFiltreCandidatures } from '@/lib/candidatures-schemas'
import { verifyRole } from '@/lib/dal'
import { prisma } from '@/lib/prisma'

// ─── Liste « Mes candidatures » (M7, espace candidat) ────────────────────────
//
// URL FIXE /candidat/candidatures : c'est LA cible des retours des actions
// candidat (`?maj=envoyee`, `?maj=retiree` en succès, `?erreur=<cle>` en
// refus) — les deux bandeaux ci-dessous se lisent donc ici, avec les
// helpers fail-closed de src/lib/candidatures-labels.ts (clé inconnue,
// absente ou non chaîne → aucun bandeau, jamais de texte libre repris de
// l'URL). Ordre imposé, identique au dashboard M6 : 1) rôle autoritaire
// (`verifyRole('candidat')`), 2) périmètre (`Candidat` du compte) → `null`
// = 404, jamais de 403.
//
// Filtre `?statut=`/`?page=` : SEULES ces deux clés sont extraites de
// searchParams AVANT le safeParse — `schemaFiltreCandidatures` est
// `.strict()`, donc un `?maj=`/`?erreur=` (ou tout paramètre étranger)
// ferait ÉCHOUER le parse s'il était passé tel quel. Échec → filtre ENTIER
// ignoré, SANS erreur (URL corrompue = filtre ignoré, motif M6) : la chip
// « Toutes » redevient l'actif par défaut. « Toutes » = paramètre `statut`
// ABSENT (jamais `?statut=toutes`, valeur qui n'existe pas dans l'ENUM).
//
// Volume : 15 lignes par page (CANDIDATURES_PAR_PAGE, parité legacy
// `paginate(15)`) → pagination obligatoire ici, contrairement au dashboard
// recruteur M6 (borné par compte).
//
// Rendu serveur async : règle du spike #98097 documentée en M5/M6 (la
// suspension n'est pas reproduite en 16.3.6) — aucun loading.tsx ajouté.
// Tests : aucun (couverture V3-J), motif M6.
// ---------------------------------------------------------------------------

/** Libellé EXACT du lien de nav.ts / footer.tsx (« Mes candidatures »). */
export const metadata: Metadata = {
  title: 'Mes candidatures',
}

/** Bandeau de succès `?maj=` (tokens M2, motif ALERTE_SUCCES de M6). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus `?erreur=` (tokens M2, motif ALERTE_ERREUR de M6). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/** Pastille de filtre active (libellés exacts OPTIONS_FILTRE_CANDIDATURE.candidat). */
const CLASSE_PASTILLE_ACTIVE =
  'inline-flex h-9 items-center rounded-full border border-brand bg-brand px-3 text-sm font-medium text-white'

const CLASSE_PASTILLE =
  'inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink'

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?maj=a&maj=b` (tableau)
 * n'a pas de sens : passé à `null`, les helpers ne rendent rien (motif M6,
 * repris à l'identique).
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

export default async function PageCandidaturesCandidat({
  searchParams,
}: PageProps<'/candidat/candidatures'>) {
  // 1. Rôle (autoritaire) puis 2. périmètre — même ordre que les actions.
  const session = await verifyRole('candidat')
  const candidat = await prisma.candidat.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  })
  // Rôle revendiqué sans ligne `Candidat` : même 404 que toute donnée de
  // périmètre absente (motif `candidatDuCompte` de l'action M7).
  if (candidat === null) notFound()

  const params = await searchParams

  // Filtre validé AVANT toute lecture : deux clés seulement, échec → rien.
  const parse = schemaFiltreCandidatures.safeParse({
    statut: paramUnique(params.statut) ?? undefined,
    page: paramUnique(params.page) ?? undefined,
  })
  const filtres: FiltresCandidatures = parse.success ? parse.data : {}

  const candidatures = await listerCandidaturesCandidat(candidat.id, filtres)
  const bandeauSucces = messageMajCandidature(paramUnique(params.maj))
  const bandeauErreur = messageErreurCandidature(paramUnique(params.erreur))

  // Chip active : `statut` absent (ou filtre retombé) = « Toutes ».
  const statutActif = filtres.statut ?? 'toutes'

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mes candidatures</h1>
        {/* Plurialisation : « 1 candidature » / « N candidatures ». Le
            compteur porte le même `where` que la liste (filtre compris). */}
        <p className="mt-2 text-base text-ink-muted">
          {`${candidatures.total} ${candidatures.total === 1 ? 'candidature' : 'candidatures'}`}
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

      <nav aria-label="Filtrer les candidatures" className="flex flex-wrap items-center gap-2">
        {OPTIONS_FILTRE_CANDIDATURE.candidat.map(({ valeur, libelle }) => {
          const actif = valeur === statutActif
          return (
            <Link
              key={valeur}
              href={{
                pathname: '/candidat/candidatures',
                // « Toutes » = chemin NU (aucun paramètre) ; le reste = ?statut=<valeur>.
                query: valeur === 'toutes' ? {} : { statut: valeur },
              }}
              aria-current={actif ? 'page' : undefined}
              className={actif ? CLASSE_PASTILLE_ACTIVE : CLASSE_PASTILLE}
            >
              {libelle}
            </Link>
          )
        })}
      </nav>

      {candidatures.items.length === 0 ? (
        /* État vide EXACT : identique que le filtre soit actif ou non. */
        <Card className="text-center">
          <div className="py-8">
            <IconBriefcase size={40} className="mx-auto text-brand opacity-25" />
            <div className="mt-4 text-sm font-medium text-ink">
              Aucune candidature pour le moment.
            </div>
            <div className="mt-1 text-sm text-ink-muted">
              Parcourez les offres publiées et postulez à celles qui vous correspond.
            </div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {candidatures.items.map((candidature) => (
            <li key={candidature.id}>
              <CarteCandidature candidature={candidature} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={candidatures.page}
        pages={candidatures.pages}
        chemin="/candidat/candidatures"
        parametres={{ statut: filtres.statut }}
      />
    </div>
  )
}
