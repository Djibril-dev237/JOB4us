import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { messageErreurCandidature, messageMajCandidature } from '@/lib/candidatures-labels'
import { prisma } from '@/lib/prisma'
import { lireOffrePublique } from '@/lib/offres-public'

import { FormulairePostulation } from './formulaire-postulation'

// ─── Postulation à une offre (M7) ────────────────────────────────────────────
//
// URL : /offres/<slug>/postuler. Ordre des contrôles :
//  1. offre : `lireOffrePublique(slug)` → null → notFound(), EXACTEMENT le
//     même 404 que la fiche (même prédicat, aucune fuite d'existence) ;
//  2. session : `auth()` et JAMAIS `verifySession` (cette page est la seule
//     du parcours qui redirige — la fiche publique, elle, reste neutre).
//     Visiteur → /login?redirect=<retour> ; connecté non-candidat →
//     /unauthorized (motifs déjà posés par dal.ts / le proxy) ;
//  3. doublon anticipé : la candidature éventuelle remplace le FORMULAIRE
//     (bloc « déjà postulé ») — c'est le même texte que `?erreur=doublon`
//     de l'action, lu ici en base.
//
// Retours d'action (motif M6 repris à la lettre) : `?maj=envoyee` affiche
// la confirmation qui REMPLACE le formulaire (prioritaire sur le doublon :
// au retour de l'action, la ligne vient d'être créée, le doublon serait
// sinon toujours vrai) ; `?erreur=<cle>` pose un bandeau AU-DESSUS du
// formulaire via messageErreurCandidature (fail-closed : clé inconnue ou
// absente → null → aucun bandeau, jamais de texte libre depuis l'URL).
//
// Requêtes : offre (1) + candidat (1) + doublon (1) = 3, aucune par ligne.
// Rendu serveur async sous loading.tsx hérité de /offres/[slug] : règle du
// spike #98097 documentée sur /recruteur/offres, aucun loading.tsx ajouté.
// ---------------------------------------------------------------------------

/** Titre court : le template global ajoute « | Job4Us ». */
export const metadata: Metadata = { title: "Postuler à l'offre" }

/** Bandeau de refus `?erreur=` (tokens M2, motif ALERTE_ERREUR de M6). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?maj=a&maj=b` (tableau)
 * n'a pas de sens : passé à `null`, les helpers ne rendent rien (copie du
 * motif de /recruteur/offres).
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

export default async function PagePostulation({
  params,
  searchParams,
}: PageProps<'/offres/[slug]/postuler'>) {
  const { slug } = await params

  // 1. Même 404 que la fiche publique (prédicat unique de visibilité).
  const offre = await lireOffrePublique(slug)
  if (offre === null) notFound()

  // 2. Session : lecture non mémorisée, contrôles dans le même ordre que
  //    dal.ts (claims absents → /login, rôle insuffisant → /unauthorized).
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (session === null || typeof userId !== 'number') {
    redirect(`/login?redirect=/offres/${slug}/postuler`)
  }
  if (role !== 'candidat') {
    redirect('/unauthorized')
  }

  // 3. Candidat du compte : UNE seule requête sert le cvPath (source
  //    `profil`) ET la clé du contrôle de doublon. Un compte candidat sans
  //    ligne Candidat n'a rien à postuler → même refus qu'un rôle inconnu.
  const candidat = await prisma.candidat.findUnique({
    where: { userId },
    select: { id: true, cvPath: true },
  })
  if (candidat === null) redirect('/unauthorized')

  const candidature = await prisma.candidature.findUnique({
    where: { offreId_candidatId: { offreId: offre.id, candidatId: candidat.id } },
    select: { id: true },
  })

  const donnees = await searchParams
  // Confirmation : UNIQUEMENT la clé `envoyee` de cette page, résolue par
  // l'helper fail-closed (un `?maj=` inconnu ou `retiree` n'affiche rien).
  const cleMaj = paramUnique(donnees.maj)
  const confirmation = cleMaj === 'envoyee' ? messageMajCandidature(cleMaj) : null
  const erreur = messageErreurCandidature(paramUnique(donnees.erreur))

  // Priorité : confirmation > doublon > formulaire (cf. en-tête). La
  // confirmation exige la LIGNE réelle : `?maj=envoyee` est forgerable
  // (lien piégé, auto-antislash) — sans candidature, pas de mensonge
  // « Candidature envoyée. » (P3-7 revue M7).
  let contenu: ReactNode
  if (confirmation !== null && candidature !== null) {
    contenu = (
      <Card role="status">
        <h2 className="text-base font-semibold text-ink">{confirmation}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Votre candidature a bien été transmise à l&apos;entreprise.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/candidat/candidatures" className={buttonClassName('primary')}>
            Mes candidatures
          </Link>
          <Link href={`/offres/${slug}`} className={buttonClassName('secondary')}>
            Retour à l&apos;offre
          </Link>
        </div>
      </Card>
    )
  } else if (candidature !== null) {
    contenu = (
      <Card role="status">
        <p className="text-base font-semibold text-ink">
          Vous avez déjà postulé à cette offre.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`/candidat/candidatures/${candidature.id}`}
            className={buttonClassName('primary')}
          >
            Voir ma candidature
          </Link>
          <Link href={`/offres/${slug}`} className={buttonClassName('secondary')}>
            Retour à l&apos;offre
          </Link>
        </div>
      </Card>
    )
  } else {
    contenu = (
      <>
        {erreur !== null ? (
          <p role="alert" className={CLASSE_ERREUR}>
            {erreur}
          </p>
        ) : null}
        <Card>
          <FormulairePostulation slug={slug} aProfilCv={candidat.cvPath !== null} />
        </Card>
      </>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Postuler à l&apos;offre</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-base text-ink-muted">
          <span>{offre.titre}</span>
          <span aria-hidden="true">·</span>
          <span>{offre.entreprise.nom}</span>
        </p>
      </div>

      {contenu}
    </div>
  )
}
