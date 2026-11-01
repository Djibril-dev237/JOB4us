import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TEXTES_MODERATION } from '@/lib/admin-moderation-texts'
import { accesSignalementValide, reauthAdminValide } from '@/lib/admin-reauth'
import { LIBELLES_STATUT, VARIANTE_STATUT } from '@/lib/candidatures-labels'
import { requireAdmin } from '@/lib/dal'
import { TEXTES, libelleStatutSignalement } from '@/lib/messagerie-labels'
import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import { libelleDecision, libelleMotif } from '@/lib/moderation-labels'
import { prisma } from '@/lib/prisma'

import { FORMATEUR_DATE, FORMATEUR_DATE_HEURE } from '../affichage'
import { BandeauAdmin } from '@/components/admin/bandeau-admin'
import { EnTeteAdmin } from '@/components/admin/en-tete-admin'

import { AccesSignalementForm, DecisionSignalementForm, RetablirMessageForm } from './formulaires'

// ─── Détail d'un signalement — /admin/signalements/[signalementId] (M10) ─────
//
// Contrôles dans l'ordre imposé :
//   1) `requireAdmin()` : visiteur, non-admin, admin suspendu ou admin sans
//      TOTP reçoivent le MÊME 404 strict, sans redirection révélatrice ;
//   2) id strict : entier positif borné `MAX_IDENTIFIANT`, sinon `notFound()` ;
//   3) métadonnées seules : aucune requête sur `Message.contenu` avant que le
//      grant de signalement ne soit valide.
//
// Procédure de consultation privée :
//   * l'admin choisit un motif fermé et se réauthentifie ;
//   * l'action écrit l'audit AVANT de délivrer un cookie signé de 5 minutes ;
//   * la page ne charge les 30 messages de contexte qu'avec ce grant.
//
// Une décision exige en plus le grant : on ne décide pas d'un contenu qu'on
// n'a pas été autorisé à consulter. Le masquage et la suspension sont des
// écritures append-only/auditées ; aucune suppression physique n'existe ici.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: TEXTES.titreSignalements,
}

/** Messages de contexte affichés autour du message signalé. */
const CONTEXTE_MAX = 30

export default async function PageSignalement({
  params,
}: PageProps<'/admin/signalements/[signalementId]'>) {
  // 1. Garde administrateur stricte, AVANT toute lecture.
  const session = await requireAdmin()

  // 2. id strict (Next 16 : `params` est résolu).
  const { signalementId } = await params
  const id = Number(signalementId)
  if (!Number.isInteger(id) || id <= 0 || id > MAX_IDENTIFIANT) notFound()

  // 3. Métadonnées seules. `contenu` n'est volontairement pas sélectionné.
  const signalement = await prisma.signalement.findUnique({
    where: { id },
    select: {
      id: true,
      messageId: true,
      motif: true,
      statut: true,
      decision: true,
      motifDecision: true,
      noteInterne: true,
      createdAt: true,
      traiteLe: true,
      auteur: { select: { name: true } },
      traitePar: { select: { name: true } },
      message: {
        select: {
          id: true,
          senderId: true,
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

  // 4. État des deux grants. Le grant de signalement est lié à l'admin et au
  //    signalement ; la réauthentification est une fenêtre séparée de 5 min.
  const [acces, reauth] = await Promise.all([
    accesSignalementValide(session.userId, signalement.id),
    reauthAdminValide(session.userId),
  ])

  const cheminRetour = `/admin/signalements/${signalement.id}`
  const conversationId = signalement.message.conversation.id
  const { candidature } = signalement.message.conversation
  const { offre } = candidature

  // 5. Contenu privé : UNIQUEMENT avec le grant. La fenêtre est calée sur le
  //    message signalé pour qu'il soit toujours visible, même ancien.
  const contexte = acces
    ? await (async () => {
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
        const fenetre = derniers.some((message) => message.id === signalement.messageId)
          ? derniers
          : await prisma.message.findMany({
              where: {
                conversationId,
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
        return [...fenetre].reverse()
      })()
    : null

  // 6. État de masquage du message signalé : la DERNIÈRE ligne de modération
  //    décide. Une requête ciblée, aucun contenu.
  const derniereModeration = acces
    ? await prisma.messageModeration.findFirst({
        where: { messageId: signalement.messageId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { action: true },
      })
    : null
  const messageMasque = derniereModeration?.action === 'masquage'

  const nomsParticipants = new Map<number, string>([
    [candidature.candidat.user.id, candidature.candidat.user.name],
    [offre.entreprise.user.id, offre.entreprise.user.name],
  ])

  const hrefOffre =
    offre.slug !== null && offre.deletedAt === null ? `/offres/${offre.slug}` : null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <EnTeteAdmin
        titre={TEXTES.titreSignalements}
        description="Détail d’un signalement et accès encadré au contenu privé."
      />

      {acces ? <BandeauAdmin variante="info" message={TEXTES.moderationLue} /> : null}

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
        <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
          {signalement.motif}
        </p>

        <p className="mt-4 min-w-0 break-words text-sm text-ink-muted">
          {signalement.auteur.name}
        </p>
      </Card>

      {!acces ? (
        <AccesSignalementForm
          signalementId={signalement.id}
          reauth={reauth}
          cheminRetour={cheminRetour}
        />
      ) : (
        <>
          <section
            aria-labelledby="titre-contexte"
            className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-card"
          >
            <h2 id="titre-contexte" className="text-base font-bold text-ink">
              {TEXTES_MODERATION.contexteTitre}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {TEXTES_MODERATION.conversationPriveeAide}
            </p>

            <div className="mt-3 border-t border-line pt-3">
              <h3 className="min-w-0 break-words text-sm font-bold text-ink">
                {offre.titre}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                <span className="min-w-0 break-words">{candidature.candidat.user.name}</span>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 break-words">{offre.entreprise.user.name}</span>
                <span aria-hidden="true">·</span>
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
            </div>

            {contexte === null || contexte.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">{TEXTES_MODERATION.contexteVide}</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {contexte.map((message) => {
                  const signale = message.id === signalement.messageId
                  return (
                    <li
                      key={message.id}
                      className={`min-w-0 rounded-md border px-3 py-2 ${
                        signale ? 'border-danger bg-danger-tint' : 'border-line bg-surface-alt'
                      }`}
                    >
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-xs font-semibold text-ink">
                          {nomsParticipants.get(message.senderId) ?? ''}
                          {signale ? (
                            <span className="ml-2 text-danger">
                              {TEXTES_MODERATION.messageSignale}
                            </span>
                          ) : null}
                        </span>
                        <time
                          dateTime={message.createdAt.toISOString()}
                          className="shrink-0 text-xs text-ink-muted"
                        >
                          {FORMATEUR_DATE_HEURE.format(message.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
                        {message.contenu}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {signalement.statut === 'ouvert' ? (
            <DecisionSignalementForm
              signalementId={signalement.id}
              statut={signalement.statut}
              cheminRetour={cheminRetour}
            />
          ) : null}

          <RetablirMessageForm
            messageId={signalement.messageId}
            masque={messageMasque}
            cheminRetour={cheminRetour}
          />
        </>
      )}

      {signalement.statut === 'traite' ? (
        <Card>
          <h2 className="text-base font-bold text-ink">{TEXTES_MODERATION.traiteTitre}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{libelleStatutSignalement('traite')}</Badge>
            {signalement.traiteLe !== null ? (
              <time
                dateTime={signalement.traiteLe.toISOString()}
                className="text-xs text-ink-muted"
              >
                {FORMATEUR_DATE_HEURE.format(signalement.traiteLe)}
              </time>
            ) : null}
            {signalement.traitePar !== null ? (
              <span className="min-w-0 break-words text-xs text-ink-muted">
                {TEXTES_MODERATION.traitePar} {signalement.traitePar.name}
              </span>
            ) : null}
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {TEXTES_MODERATION.decisionChamp}
              </dt>
              <dd className="mt-0.5 text-ink">{libelleDecision(signalement.decision)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {TEXTES_MODERATION.motifChamp}
              </dt>
              <dd className="mt-0.5 text-ink">
                {signalement.motifDecision === null
                  ? TEXTES_MODERATION.nonRenseigne
                  : libelleMotif(signalement.motifDecision)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {TEXTES.noteInterne}
              </dt>
              <dd className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-ink">
                {signalement.noteInterne ?? TEXTES_MODERATION.nonRenseignee}
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </div>
  )
}
