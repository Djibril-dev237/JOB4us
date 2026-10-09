import Link from 'next/link'
import { notFound } from 'next/navigation'

import { retirerCandidature } from '@/app/actions/candidatures'
import { Badge } from '@/components/ui/badge'
import { Button, buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { detailCandidatureCandidat } from '@/lib/candidatures-dal'
import {
  LIBELLES_STATUT,
  STATUTS_TERMINAUX,
  VARIANTE_STATUT,
} from '@/lib/candidatures-labels'
import { verifyRole } from '@/lib/dal'
import { TYPE_CONTRAT_LABELS } from '@/lib/definitions'
import { dateRelativeFr } from '@/lib/dates'
import { prisma } from '@/lib/prisma'

// ─── Fiche d'une candidature, vue par SON candidat (M7) ──────────────────────
//
// Ordre imposé (motif M6) : 1) rôle autoritaire `verifyRole('candidat')`,
// 2) périmètre (`Candidat` du compte) → `null` = 404, 3) contrôle d'URL
// (`id` numérique strictement positif, sinon le MÊME 404 — jamais de 400),
// 4) lecture portant `candidatId` + `id` dans LE MÊME `where`.
//
// CRITÈRE M7 (doctrine 404 M6/M7) : la candidature d'un AUTRE candidat
// produit exactement le même `null` qu'une ligne inexistante, converti ici
// en `notFound()` — 404 STRICTEMENT IDENTIQUE, aucun code ni message
// distinct, jamais de 403 ni de branche « pas la vôtre » : un 403 (ou une
// réponse différente) laisserait sonder /candidat/candidatures/1, 2, 3…
// et révélerait l'existence des lignes d'autrui. Le périmètre est posé DANS
// la requête du DAL (jamais une lecture puis un contrôle : pas de TOCTOU).
//
// CV joint : le booléen `cvSelectionne` pilote un lien vers la route
// dédiée ?candidature=<id> (livrée en V3-H) : elle sert le SNAPSHOT de la
// ligne (le propriétaire y est autorisé par la matrice d'accès, verrouillé
// par les tests de route) — jamais le cvPath actuel du profil. Mention
// « copie figée » + « Voir le CV » (libellé du panneau recruteur).
//
// Rendu serveur async (règle #98097, M5/M6) : aucun loading.tsx ajouté.
// Tests : aucun (couverture V3-J), motif M6.
// ---------------------------------------------------------------------------

export default async function PageDetailCandidature({
  params,
}: PageProps<'/candidat/candidatures/[id]'>) {
  // 1. Rôle puis 2. périmètre du compte — avant toute lecture de ligne.
  const session = await verifyRole('candidat')
  const candidat = await prisma.candidat.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  })
  if (candidat === null) notFound()

  // 3. id mal formé ou non strictement positif → le MÊME 404 qu'une ligne
  //    absente (aucune erreur 400 distincte, motif page d'édition M6).
  const { id } = await params
  if (!/^\d+$/.test(id) || Number(id) < 1) notFound()

  // 4. Existence + propriété dans le MÊME where (cf. critère M7 ci-dessus).
  const candidature = await detailCandidatureCandidat(candidat.id, Number(id))
  if (candidature === null) notFound()

  const { offre, statut, createdAt, lettreMotivation, cvSelectionne, offreRetiree } =
    candidature

  // Lien vers la fiche publique : UNIQUEMENT si l'offre est toujours en
  // ligne ET slughée — une offre retirée n'a plus de fiche accessible, et
  // l'entrée legacy /offres/<id> numérique répond 404 (contrat M5) : pas de
  // lien mort. `slug === null` ne peut donc pas être lien non plus.
  const hrefOffre = !offreRetiree && offre.slug !== null ? `/offres/${offre.slug}` : null

  // La candidature se fige pour le candidat sur un statut terminal.
  const retirable = !STATUTS_TERMINAUX.includes(statut)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 grow basis-64">
          {/* Titre de l'offre : lien vers la fiche publique tant qu'elle est
              en ligne, texte simple sinon (jamais de lien cassé). */}
          <h1 className="break-words text-2xl font-bold tracking-tight text-ink">
            {hrefOffre !== null ? (
              <Link
                href={hrefOffre}
                className="transition-colors duration-fast hover:text-brand"
              >
                {offre.titre}
              </Link>
            ) : (
              offre.titre
            )}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={VARIANTE_STATUT[statut]}>{LIBELLES_STATUT[statut]}</Badge>
            {offreRetiree ? <Badge variant="warn">Offre retirée du site</Badge> : null}
          </div>

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{offre.nomEntreprise}</span>
            <span aria-hidden="true">·</span>
            <span>{offre.ville}</span>
            <span aria-hidden="true">·</span>
            <span>{TYPE_CONTRAT_LABELS[offre.typeContrat]}</span>
            <span aria-hidden="true">·</span>
            {/* Date de la candidature relative (motif M5/admin : le helper
                vit dans src/lib/dates.ts, il n'a qu'une implémentation). */}
            <time dateTime={createdAt.toISOString()} className="shrink-0">
              {dateRelativeFr(createdAt)}
            </time>
          </p>
        </div>

        <Link href="/candidat/candidatures" className={buttonClassName('secondary')}>
          Retour à mes candidatures
        </Link>
      </div>

      <Card>
        <h2 className="text-base font-semibold text-ink">Lettre de motivation</h2>
        {lettreMotivation !== null ? (
          // Texte libre du candidat : conservé tel quel (retours à la ligne
          // inclus), JAMAIS d'injection de HTML (motif M5 : whitespace-pre-wrap).
          <p className="mt-2 break-words whitespace-pre-wrap text-sm text-ink-muted">
            {lettreMotivation}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Aucune lettre de motivation.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-ink">CV joint</h2>
        {cvSelectionne ? (
          <>
            <p className="mt-2 text-sm text-ink-muted">
              CV joint à cette candidature (copie figée)
            </p>
            {/* La route V3-H sert le SNAPSHOT de cette ligne (matrice : le
                propriétaire y est autorisé) — jamais le cvPath actuel du
                profil : le CV envoyé reste figé, critère M7. */}
            <a
              href={`/api/files/cv?candidature=${candidature.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-brand hover:underline duration-fast"
            >
              Voir le CV
            </a>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Aucun CV joint.</p>
        )}
      </Card>

      {/* Retrait : masqué sur un statut terminal (matrice TRANSITIONS — le
          candidat n'y peut plus rien), l'action re-vérifie de toute façon. */}
      {retirable ? (
        <form action={retirerCandidature}>
          {/* Champ caché : la cible vient TOUJOURS du formulaire, jamais d'une
              saisie visible (l'action re-valide rôle + périmètre + statut). */}
          <input type="hidden" name="id" value={candidature.id} />
          <Button type="submit" variant="danger">
            Retirer ma candidature
          </Button>
        </form>
      ) : null}
    </div>
  )
}
