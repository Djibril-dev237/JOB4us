import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { LIBELLES_STATUT, VARIANTE_STATUT } from '@/lib/candidatures-labels'
import { verifyRole } from '@/lib/dal'
import { TEXTES, libelleStatutSignalement } from '@/lib/messagerie-labels'
import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import { prisma } from '@/lib/prisma'

import { FORMATEUR_DATE, FORMATEUR_DATE_HEURE } from '../affichage'
import { Bandeau } from '../bandeau'

import { CloturerSignalement } from './cloturer'

// ─── Détail d'un signalement — /admin/signalements/[signalementId] (SA-8) ────
//
// Contrôles dans l'ordre imposé (motif M6/M7) :
//   1) rôle autoritaire `verifyRole('admin')` → autre rôle → /unauthorized ;
//   2) id strict : entier strictement positif ET borné `MAX_IDENTIFIANT`,
//      sinon `notFound()` — même 404 qu'une ligne absente (un id géant
//      ferait échouer Prisma hors de toute gestion : critère « zéro 500 ») ;
//   3) `signalement` absent → `notFound()`.
//
// JOURNALISATION AVANT TOUT RENDU, NON BEST-EFFORT : la consultation d'un
// signalement (donc d'une conversation privée) est un acte sensible —
// `AuditConversation.create` est ATTENDU avant le moindre rendu et SANS
// try/catch : si l'écriture échoue, la page échoue. Une consultation non
// journalisée n'a pas lieu d'être affichée (Étape 2 de la modération).
// Ce n'est PAS le comportement de `marquerConversationLue` (best-effort) :
// là, l'absence de trace invalide la mission même de l'écran.
//
// Contexte : les 30 derniers messages de la conversation, ordre ASC
// chronologique ; le message signalé est surligné (bordure + fond) — le
// contenu reste du TEXTE BRUT rendu comme dans `fil-messages.tsx`, JAMAIS
// de `dangerouslySetInnerHTML` (React échappe toute interpolation).
//
// Clôture : le composant client `CloturerSignalement` est rendu TOUJOURS
// (il décide de son propre rendu) pour que son bandeau de retour survive à
// `router.refresh()` ; le bloc « traité » (note, modérateur, date) n'apparaît
// qu'une fois le statut `traite`. Aucun texte hors TEXTES : noms, dates et
// extraits sont des DONNÉES, jamais des libellés inventés.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: TEXTES.titreSignalements,
}

/** Messages de contexte affichés autour du message signalé. */
const CONTEXTE_MAX = 30

export default async function PageSignalement({
  params,
}: PageProps<'/admin/signalements/[signalementId]'>) {
  // 1. Rôle autoritaire (la session est vérifiée AVANT la moindre lecture).
  const session = await verifyRole('admin')

  // 2. id strict (Next 16 : `params` est résolu) — bornage M8 « zéro 500 ».
  const { signalementId } = await params
  const id = Number(signalementId)
  if (!Number.isInteger(id) || id <= 0 || id > MAX_IDENTIFIANT) notFound()

  // 3. Lecture complète du signalement + de son contexte de conversation,
  //    en NOMBRE FIXE de requêtes (une seule, jointures incluses).
  const signalement = await prisma.signalement.findUnique({
    where: { id },
    include: {
      auteur: { select: { name: true } },
      traitePar: { select: { name: true } },
      message: {
        select: {
          id: true,
          contenu: true,
          createdAt: true,
          conversation: {
            select: {
              id: true,
              candidature: {
                select: {
                  statut: true,
                  candidat: { select: { user: { select: { id: true, name: true } } } },
                  offre: {
                    select: {
                      titre: true,
                      slug: true,
                      deletedAt: true,
                      entreprise: {
                        select: { user: { select: { id: true, name: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (signalement === null) notFound()

  // 4. JOURNALISATION — ATTENDUE avant tout rendu, jamais best-effort : si
  //    cette écriture échoue, la page échoue (aucune consultation privée
  //    affichée sans trace d'audit).
  await prisma.auditConversation.create({
    data: {
      conversationId: signalement.message.conversation.id,
      acteurId: session.userId,
      signalementId: signalement.id,
    },
  })

  // 5. Contexte : 30 derniers messages (DESC) renversés en ASC — Prisma ne
  //    sait pas « 30 derniers ASC » en une seule requête, d'où le renversement.
  const conversationId = signalement.message.conversation.id
  const selectContexte = {
    id: true,
    contenu: true,
    senderId: true,
    createdAt: true,
  } as const
  const derniers = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CONTEXTE_MAX,
    select: selectContexte,
  })
  // Si le message signalé est PLUS ANCIEN que la fenêtre (vieille
  // conversation), on la recale pour qu'elle se termine SUR le message
  // signalé : l'extrait doit CONTENIR la cible, sinon rien n'est surligné.
  const fenetre = derniers.some((message) => message.id === signalement.messageId)
    ? derniers
    : await prisma.message.findMany({
        where: {
          conversationId,
          // Plafond LEXICOGRAPHIQUE (createdAt, id) et non `lte` simple :
          // un message de même horodatage mais d'id SUPÉRIEUR trierait
          // avant la cible (ordre `id desc`) et pourrait l'expulser de la
          // fenêtre de 30 — la cible doit toujours être incluse, sinon
          // rien n'est surligné dans l'extrait.
          OR: [
            { createdAt: { lt: signalement.message.createdAt } },
            {
              createdAt: signalement.message.createdAt,
              id: { lte: signalement.messageId },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CONTEXTE_MAX,
        select: selectContexte,
      })
  const contexte = [...fenetre].reverse()

  // 6. Métadonnées de conversation : participants (noms) et expéditeur de
  //    chaque message — les deux seuls participants d'une conversation sont
  //    le candidat et le propriétaire courant de l'offre (modèle M8 : les
  //    participants se dérivent de la candidature, jamais copiés).
  const { candidature } = signalement.message.conversation
  const { offre } = candidature
  const nomsParticipants = new Map<number, string>([
    [candidature.candidat.user.id, candidature.candidat.user.name],
    [offre.entreprise.user.id, offre.entreprise.user.name],
  ])

  // Lien vers l'offre UNIQUEMENT si elle est encore consultable (motif de
  // carte-candidature : slug présent et offre non retirée) — jamais de lien
  // mort vers une fiche supprimée.
  const hrefOffre =
    offre.slug !== null && offre.deletedAt === null ? `/offres/${offre.slug}` : null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        {TEXTES.titreSignalements}
      </h1>

      {/* Rappel permanent : toute consultation de cette page est journalisée. */}
      <Bandeau variante="info" message={TEXTES.moderationLue} />

      {/* Carte du signalement : motif (donnée saisi par le signalant),
          auteur, statut et date de création. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={signalement.statut === 'ouvert' ? 'warn' : 'neutral'}>
            {libelleStatutSignalement(signalement.statut)}
          </Badge>
          <time dateTime={signalement.createdAt.toISOString()} className="text-xs text-ink-muted">
            {FORMATEUR_DATE.format(signalement.createdAt)}
          </time>
        </div>

        <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {TEXTES.motifSignalement}
        </h2>
        {/* Texte brut échappé par React : aucun balisage rendu, aucun
            `dangerouslySetInnerHTML`. */}
        <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
          {signalement.motif}
        </p>

        {/* Auteur du signalement (donnée, pas un libellé). */}
        <p className="mt-4 min-w-0 break-words text-sm text-ink-muted">
          {signalement.auteur.name}
        </p>
      </Card>

      {/* Contexte de la conversation : participants, statut de la
          candidature, offre, puis les messages (message signalé surligné). */}
      <section
        aria-labelledby="titre-contexte"
        className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-card"
      >
        <h2 id="titre-contexte" className="min-w-0 break-words text-base font-bold text-ink">
          {offre.titre}
        </h2>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <span className="min-w-0 break-words">{candidature.candidat.user.name}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 break-words">{offre.entreprise.user.name}</span>
          <span aria-hidden="true">·</span>
          {/* Statut de la candidature : labels partagés M7 (source unique),
              jamais de libellé recopié ici. */}
          <Badge variant={VARIANTE_STATUT[candidature.statut]}>
            {LIBELLES_STATUT[candidature.statut]}
          </Badge>
        </p>

        {hrefOffre !== null ? (
          <Link
            href={hrefOffre}
            className="mt-2 inline-flex text-sm font-medium text-brand transition-colors duration-fast hover:text-brand-dark"
          >
            {TEXTES.lienOffre}
          </Link>
        ) : null}

        <ul className="mt-4 space-y-3">
          {contexte.map((message) => {
            const signale = message.id === signalement.messageId
            return (
              <li
                key={message.id}
                // Message signalé : bordure + fond « danger » — surlignage
                // purement CSS, le contenu reste du texte brut.
                className={`min-w-0 rounded-md border px-3 py-2 ${
                  signale ? 'border-danger bg-danger-tint' : 'border-line bg-surface-alt'
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-xs font-semibold text-ink">
                    {nomsParticipants.get(message.senderId) ?? ''}
                  </span>
                  <time
                    dateTime={message.createdAt.toISOString()}
                    className="shrink-0 text-xs text-ink-muted"
                  >
                    {FORMATEUR_DATE.format(message.createdAt)}
                  </time>
                </div>
                <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
                  {message.contenu}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Formulaire de clôture (client) : rendu TOUJOURS — il ne montre le
          formulaire que si le signalement est encore ouvert, et conserve son
          bandeau de retour après `router.refresh()`. */}
      <CloturerSignalement signalementId={signalement.id} statut={signalement.statut} />

      {/* Signalement déjà traité (à l'ouverture ou après clôture) : statut,
          note interne, modérateur et date — AUCUN formulaire. */}
      {signalement.statut === 'traite' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{libelleStatutSignalement('traite')}</Badge>
            {signalement.traiteLe !== null ? (
              <time
                dateTime={signalement.traiteLe.toISOString()}
                className="text-xs text-ink-muted"
              >
                {FORMATEUR_DATE_HEURE.format(signalement.traiteLe)}
              </time>
            ) : null}
            {/* Modérateur : le NOM est une donnée (aucun libellé inventé). */}
            {signalement.traitePar !== null ? (
              <span className="min-w-0 break-words text-xs text-ink-muted">
                {signalement.traitePar.name}
              </span>
            ) : null}
          </div>

          <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {TEXTES.noteInterne}
          </h2>
          <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
            {signalement.noteInterne ?? '—'}
          </p>
        </Card>
      ) : null}
    </div>
  )
}
