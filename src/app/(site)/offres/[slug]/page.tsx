import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import type { Session } from 'next-auth'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'

import { auth } from '@/auth'
import { FicheOffre } from '@/components/offres/fiche-offre'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { lireOffrePublique, listerOffresSimilaires } from '@/lib/offres-public'

// ─── Fiche publique d'une offre (M5, task 5) ─────────────────────────────────
//
// URL : /offres/<slug> (contrate task 4 : « titre-slug-<id> »). L'entrée
// legacy /offres/<id> numérique répond 404 — le regex de src/lib/slug.ts
// rejette l'ancien format AVANT toute requête, puis la DAL applique le
// prédicat unique : brouillon, expirée, recruteur suspendu et slug inconnu
// produisent tous notFound() — 404 strictement identique, aucune fuite
// d'existence. La règle du spike #98097 (rendu serveur async, suspension
// M2-M4 non reproduite en 16.3.6) s'applique ici aussi.
//
// D10 (M6) : le JSX de RENDU a été déplacé tel quel dans
// src/components/offres/fiche-offre.tsx (composant pur partagé avec
// l'aperçu du formulaire recruteur) — cette page ne fait que l'héberger :
// mêmes arbres, même sortie HTML, aucune requête de plus. La structure
// détaillée (parité show.blade.php, a11y) est documentée au composant.
//
// M7 : cette page est le SEUL hôte qui fournit `blocCandidature` (JSX de
// la colonne droite, selon l'état de session). L'aperçu recruteur continue
// de n'en envoyer aucun — aucun JSX de fiche n'est dupliqué ici.
//
// Requêtes : findFirst (fiche) + findMany (similaires) = 2, aucune par
// ligne — verrouillé par le test « comptage de requêtes par page ». Cache
// (task 7) : dédoublonnage INTRA-requête via React cache() entre
// generateMetadata et la page (une seule requête pour les deux, cf.
// lireOffreMiseEnCache) ; aucun cache de résultat entre requêtes — une
// offre devenue invisible doit 404 immédiatement. La lecture de session
// (cookie JWT, aucune requête base) n'entre pas dans ce décompte.
// ---------------------------------------------------------------------------

// Dédoublonnage generateMetadata ↔ page : une SEULE requête findFirst par
// requête client au lieu de deux (motif React cache documenté par Next).
// Clé = slug seul : `now` est donc évalué une fois, metadata et corps de
// page partagent la même frontière d'expiration.
const lireOffreMiseEnCache = cache(lireOffrePublique)

/**
 * SEO de la fiche (task 6) : parité stricte avec `@section('title',
 * $offre->titre)` — titre seul, description héritée du layout racine
 * (le legacy n'avait ni meta description, ni canonical, ni og:, vérifié
 * sur layouts/app.blade.php). Canonical : /offres/<slug> est la forme
 * canonique publiée par la task 4 ; l'entrée legacy /offres/<id> n'a
 * jamais d'URL canonique (elle 404). Slug non visible → notFound()
 * aussi ici : même 404 que le corps de page, aucune fuite d'existence
 * dans le HTML du <head>.
 */
export async function generateMetadata({
  params,
}: PageProps<'/offres/[slug]'>): Promise<Metadata> {
  const { slug } = await params
  const offre = await lireOffreMiseEnCache(slug)
  if (offre === null) notFound()

  return {
    title: offre.titre,
    alternates: { canonical: `/offres/${offre.slug}` },
  }
}

export default async function PageOffre({ params }: PageProps<'/offres/[slug]'>) {
  const { slug } = await params
  const offre = await lireOffreMiseEnCache(slug)
  if (offre === null) notFound()

  const similaires = await listerOffresSimilaires(offre.categorie.id, offre.id)

  // M7 : auth NON BLOQUANTE — la fiche publique ne redirige jamais. La
  // lecture de session (cookie JWT, sans requête base) ne sert qu'à choisir
  // le bloc : jamais `verifySession` ici, qui redirigerait vers /login.
  const session = await auth()
  const blocCandidature = blocDeCandidature(session, slug)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <FicheOffre
        offre={offre}
        similaires={similaires}
        blocCandidature={blocCandidature}
      />
    </div>
  )
}

/**
 * Bloc M7 de la colonne droite, selon la session (jamais bloquant) :
 *
 *  * visiteur → lien /login?redirect=<retour vers la postulation> (motif de
 *    retour du projet, encodé tel quel) ;
 *  * candidat → lien vers le formulaire /offres/<slug>/postuler ;
 *  * connecté non-candidat (recruteur, admin, rôle absent) → AUCUN bloc :
 *    la colonne reste celle de M5/M6, rendu inchangé.
 *
 * Libellés exacts du cahier des charges M7 ; le bloc n'apporte aucune
 * requête ni logique — la fiche ne fait qu'insérer ce JSX reçu en prop.
 */
function blocDeCandidature(session: Session | null, slug: string): ReactNode {
  if (session === null) {
    return (
      <Card>
        <Link
          href={`/login?redirect=/offres/${slug}/postuler`}
          className={buttonClassName('secondary', 'md', 'w-full')}
        >
          Connectez-vous pour postuler
        </Link>
      </Card>
    )
  }

  if (session.user?.role === 'candidat') {
    return (
      <Card>
        <Link
          href={`/offres/${slug}/postuler`}
          className={buttonClassName('primary', 'md', 'w-full')}
        >
          Postuler à cette offre
        </Link>
      </Card>
    )
  }

  return null
}
