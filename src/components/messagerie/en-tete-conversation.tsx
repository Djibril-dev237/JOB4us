import type { StatutCandidature } from '@prisma/client'

import Link from 'next/link'

import { ActionsConversation } from '@/components/messagerie-client/actions-conversation'
import { IconArrowLeft } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { LIBELLES_STATUT } from '@/lib/candidatures-labels'
import { TEXTES, varianteStatutConversation } from '@/lib/messagerie-labels'

// ─── En-tête de la conversation ouverte (/messages/[conversationId]) ─────────
// Composant SERVEUR : lien retour vers la liste (icône seule, nom accessible
// = TEXTES.titreMessages, la destination est /messages), `h1` = titre reçu de
// la page (le nom de l'autre participant), badge de statut (variante M8 +
// libellé M7) et les actions d'interlocuteur — composant CLIENT de SA-6 rendu
// ICI côté serveur (frontière RSC → client, aucun état dans ce fichier).
//
// Interface FIGÉe SA-5/SA-6 (Vague 3 : + `bloqueeParMoi`, FORWARDÉ tel quel
// à ActionsConversation — le bascule Bloquer/Débloquer est une vérité de la
// RSC, jamais un état local). Aucun texte local : libellés = LIBELLES_STATUT
// + TEXTES.
// ---------------------------------------------------------------------------

interface Props {
  titre: string
  statut: StatutCandidature
  conversationId: number
  autreUserId: number
  autreNom: string
  /** Vrai si MOI j'ai bloqué l'interlocuteur (bouton « Débloquer »). */
  bloqueeParMoi: boolean
}

export function EnTeteConversation({
  titre,
  statut,
  conversationId,
  autreUserId,
  autreNom,
  bloqueeParMoi,
}: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/messages"
          aria-label={TEXTES.titreMessages}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        >
          <IconArrowLeft size={20} />
        </Link>

        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-ink">{titre}</h1>

        <Badge variant={varianteStatutConversation(statut)}>
          {LIBELLES_STATUT[statut]}
        </Badge>
      </div>

      {/* Client SA-6 rendu par un composant serveur (interface figée). */}
      <ActionsConversation
        conversationId={conversationId}
        autreUserId={autreUserId}
        autreNom={autreNom}
        bloqueeParMoi={bloqueeParMoi}
      />
    </header>
  )
}
