import Link from 'next/link'

import { CarteConversation } from '@/components/messagerie/carte-conversation'
import { IconChat } from '@/components/icons'
import { Card } from '@/components/ui/card'
import type { LigneListe } from '@/lib/messagerie-dal'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── Colonne « mes conversations » (liste + états vides) ─────────────────────
// Composant SERVEUR (aucun état client) : la sélection du filtre vit dans
// l'URL (`/messages` vs `/messages?filtre=non-lues`), rendue par la page puis
// passée en prop — même composant pour /messages et pour la colonne de gauche
// de /messages/[conversationId].
//
// Structure : puces de filtre (Liens GET, `aria-current="page"` sur la puce
// active) + compteur de la sélection courante, puis la colonne scrollable
// (`min-h-0`/`flex-1` : le rail porte la hauteur, le contenu scrolle — zéro
// scroll horizontal, `min-w-0` partout). Le rail lui-même (`hidden lg:flex
// lg:flex-col`) est posé par les pages.
//
// Tous les textes viennent de TEXTES (aucun libellé local) : puces de filtre,
// compteur, états vides (général = listeVide, filtre actif = listeVideNonLues).
// ---------------------------------------------------------------------------

interface Props {
  /** Lignes DÉJÀ filtrées par la page (aucun filtre appliqué ici). */
  conversations: LigneListe[]
  filtre: 'toutes' | 'non-lues'
  /** Surlignage de la conversation ouverte (vue desktop uniquement). */
  conversationActiveId: number | null
}

/** Puce active (motif des pastilles M7, tokens M2). */
const CLASSE_PUCE_ACTIVE =
  'inline-flex h-8 items-center rounded-full border border-brand bg-brand px-3 text-sm font-medium text-white'

const CLASSE_PUCE =
  'inline-flex h-8 items-center rounded-full border border-line-strong bg-surface px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink'

export function ListeConversations({
  conversations,
  filtre,
  conversationActiveId,
}: Props) {
  const vide = conversations.length === 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {/* Bascule de filtre : la puce active n'est JAMAIS un lien vers sa propre
          URL (aria-current marque l'état, l'href reste la cible du filtre). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-2">
          <Link
            href="/messages"
            aria-current={filtre === 'toutes' ? 'page' : undefined}
            className={filtre === 'toutes' ? CLASSE_PUCE_ACTIVE : CLASSE_PUCE}
          >
            {TEXTES.filtreToutes}
          </Link>
          <Link
            href="/messages?filtre=non-lues"
            aria-current={filtre === 'non-lues' ? 'page' : undefined}
            className={filtre === 'non-lues' ? CLASSE_PUCE_ACTIVE : CLASSE_PUCE}
          >
            {TEXTES.filtreNonLues}
          </Link>
        </nav>

        {/* Le compteur s'affiche UNIQUEMENT dans le sous-titre legacy
            « {n} conversation(s) » de la page : l'afficher ici en plus
            répéterait le même nombre à deux endroits. */}
      </div>

      {vide ? (
        <Card className="text-center">
          <div className="py-8">
            <IconChat size={40} className="mx-auto text-brand opacity-25" />
            <div className="mt-4 text-sm font-medium text-ink">
              {filtre === 'non-lues' ? TEXTES.listeVideNonLues : TEXTES.listeVide}
            </div>
          </div>
        </Card>
      ) : (
        <ul className="min-h-0 min-w-0 flex-1 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface shadow-card">
          {conversations.map((conversation) => (
            <li key={conversation.conversationId}>
              <CarteConversation
                conversation={conversation}
                active={conversation.conversationId === conversationActiveId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
