import type { Metadata } from 'next'

import { ListeConversations } from '@/components/messagerie/liste-conversations'
import { verifyRole } from '@/lib/dal'
import { listerConversations } from '@/lib/messagerie-dal'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── « Mes conversations » — /messages (M8, Vague 2, SA-5) ───────────────────
//
// Miroir du pattern de session de src/app/(app)/candidat/candidatures/page.tsx :
// 1) rôle AUTORITAIRE `verifyRole('candidat', 'recruteur')` — admin (ou tout
//    autre rôle) est redirigé vers /unauthorized par le DAL, 2) lecture des
//    conversations du COMPTE : `listerConversations` porte l'appartenance dans
//    son propre `where` (candidat de la candidature OU propriétaire courant de
//    l'offre) — aucune vérification séparée, aucun 403 différencié.
//
// `?filtre=` : SEULE la valeur `non-lues` est reconnue (toute autre valeur,
//    paramètre absent ou répété = « toutes ») — filtrage EN MÉMOIRE sur
//    `nonLus > 0`, le comptage étant déjà effectué par le DAL (3 requêtes
//    fixes, jamais une de plus par ligne).
//
// Puces de filtre + compteur vivent dans <ListeConversations> (source unique,
//    partagée avec la page de conversation /messages/[conversationId]) : cette
//    page ne fournit que les données, le filtre courant et l'en-tête.
// Tous les textes affichés sortent de TEXTES (aucun libellé local).
// Rendu serveur async : règle du spike #98097 — aucun loading.tsx.
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: TEXTES.titreMessages,
}

/**
 * Paramètre d'URL sous forme de chaîne UNIQUE — `?filtre=a&filtre=b`
 * (tableau) n'a aucun sens : passé à `null`, le filtre retombe sur « toutes »
 * (motif M6/M7 repris à l'identique).
 */
function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

export default async function PageMessages({ searchParams }: PageProps<'/messages'>) {
  // 1. Rôle (autoritaire) — admin → /unauthorized, jamais de rendu partiel.
  const session = await verifyRole('candidat', 'recruteur')
  // `verifyRole` a écarté tout autre rôle : le mappage est donc exhaustif.
  const role = session.role === 'candidat' ? 'candidat' : 'recruteur'

  const params = await searchParams
  const filtre: 'toutes' | 'non-lues' =
    paramUnique(params.filtre) === 'non-lues' ? 'non-lues' : 'toutes'

  const toutes = await listerConversations(session.userId, role)
  // Filtre en mémoire : `nonLus` est déjà compté côté DAL.
  const conversations =
    filtre === 'non-lues' ? toutes.filter((ligne) => ligne.nonLus > 0) : toutes

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{TEXTES.titreMessages}</h1>
        <p className="mt-2 text-base text-ink-muted">
          {conversations.length} {TEXTES.compteurConversations}
        </p>
      </div>

      <ListeConversations
        conversations={conversations}
        filtre={filtre}
        conversationActiveId={null}
      />
    </div>
  )
}
