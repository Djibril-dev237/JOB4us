import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BandeauConversation } from '@/components/messagerie/bandeau-conversation'
import { EnTeteConversation } from '@/components/messagerie/en-tete-conversation'
import { ListeConversations } from '@/components/messagerie/liste-conversations'
import { ComposerEnvoi } from '@/components/messagerie-client/composer-envoi'
import { FilMessages } from '@/components/messagerie-client/fil-messages'
import { verifyRole } from '@/lib/dal'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import {
  avancerLecture,
  chargerConversation,
  listerConversations,
  lireMessagesParCurseur,
} from '@/lib/messagerie-dal'
import { TEXTES, motifLectureSeule, texteMotifLectureSeule } from '@/lib/messagerie-labels'
import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import { prisma } from '@/lib/prisma'

// ─── Conversation ouverte — /messages/[conversationId] (M8, Vague 2, SA-5) ───
//
// Contrôles dans l'ordre imposé (motif M6/M7) :
//   1) rôle autoritaire `verifyRole('candidat', 'recruteur')` → admin →
//      /unauthorized (le DAL redirige, jamais de 403 différencié) ;
//   2) id strict : `params` résolu Next 16 (`await params`), entier strictement
//      positif sinon `notFound()` — même 404 qu'une ligne absente ;
//   3) `chargerConversation(id, userId)` porte existence + participation dans
//      LE MÊME `where` → `null` = 404 globale, strictement indiscernable d'une
//      conversation inexistante (jamais de 403, jamais de message différencié).
//
// Écritures serveur : UNE seule, `avancerLecture` (accusé de lecture `luLe`,
// 1 UPDATE CAS sur ConversationEtat — parité legacy `is_lu`), ATTENDUE avant
// le rendu et AVANT `listerConversations` pour que la pastille de non-lus de
// la colonne de gauche reflète déjà l'ouverture. Aucune autre écriture : les
// messages sont append-only, la conversation n'est jamais mutée ici.
//
// Blocage (second motif de fermeture, indépendant du statut) : UNE seule
// lecture `prisma.blocage.findFirst` avec les DEUX sens (`OR`), dérivée en
// `bloqueeParMoi` / `bloqueeParAutre` — 2 lectures maximum au total, aucun
// helper nouveau. Écriture possible = aucun des trois motifs.
//
// Bandeau : mot d'ordre « un motif, un texte » — `texteMotifLectureSeule`
// pour les 3 statuts terminaux, `TEXTES.ecritureBloquee` pour le blocage ;
// AUCUN texte local. Neutral = candidature terminale (information), danger =
// blocage d'interlocuteur (conflit).
//
// Composants CLIENT de SA-6 rendus ici (interfaces FIGÉES) : FilMessages,
// ComposerEnvoi, EnTeteConversation → ActionsConversation. Mapping DAL →
// `MessageAffiche` : `createdAt.toISOString()`.
// Rendu serveur async : règle du spike #98097 — aucun loading.tsx.
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: TEXTES.titreMessages,
}

export default async function PageConversation({
  params,
}: PageProps<'/messages/[conversationId]'>) {
  // 1. Rôle autoritaire (la session est vérifiée AVANT la moindre lecture).
  const session = await verifyRole('candidat', 'recruteur')
  // `verifyRole` a écarté tout autre rôle : le mappage est donc exhaustif.
  const role = session.role === 'candidat' ? 'candidat' : 'recruteur'

  // 2. id : entier strictement positif et borné Int32 (Next 16 : `params`
  //    est résolu). Un id géant ferait échouer Prisma hors de toute
  //    gestion (500 au lieu de 404) — même verdict qu'une ligne absente.
  const { conversationId } = await params
  const id = Number(conversationId)
  if (!Number.isInteger(id) || id <= 0 || id > MAX_IDENTIFIANT) notFound()

  // 3. Existence + participation dans LA MÊME requête → 404 indiscernable.
  const conversation = await chargerConversation(id, session.userId)
  if (conversation === null) notFound()

  // Page courante du fil (curseur null = les PAGE plus récents, ASC).
  const page = await lireMessagesParCurseur(id, session.userId, null)
  if (page === null) notFound()

  // Accusé de lecture à l'ouverture — ATTENDU avant le rendu, jamais en attente
  // (`false` = déjà à jour : aucune écriture inutile, cf. DAL). Best-effort
  // calqué sur l'action `marquerConversationLue` : un accusé qui échoue ne
  // doit pas faire tomber l'ouverture de page en 500 (le prochain poll
  // réessaiera de toute façon).
  try {
    await avancerLecture(id, session.userId)
  } catch {
    // absorbé : aucune décision utilisateur ni donnée en jeu ici.
  }

  // Motif de lecture seule au STATUT (null = conversation encore ouverte).
  const motif = motifLectureSeule(conversation.statutCandidature)

  // Blocage dans les DEUX sens : `findMany` et non `findFirst` — en cas de
  // blocage MUTUEL les deux lignes existent, et le choix arbitraire d'un
  // `findFirst` (aucun `orderBy`) orienterait le verdict : bouton « Bloquer »
  // au lieu de « Débloquer », P2002 absorbé en boucle, déblocage impossible.
  // Chaque sens est donc dérivé séparément par `some`.
  const blocages = await prisma.blocage.findMany({
    where: {
      OR: [
        { bloqueurId: session.userId, bloqueId: conversation.autre.userId },
        { bloqueurId: conversation.autre.userId, bloqueId: session.userId },
      ],
    },
    select: { bloqueurId: true },
  })
  const bloqueeParMoi = blocages.some((blocage) => blocage.bloqueurId === session.userId)
  const bloqueeParAutre = blocages.some(
    (blocage) => blocage.bloqueurId === conversation.autre.userId,
  )

  // Écriture possible : ni statut terminal, ni blocage — un SEUL aiguillage
  // pilote bandeau et composer (jamais deux logiques divergentes).
  const ecriturePossible = motif === null && !bloqueeParMoi && !bloqueeParAutre

  const bandeau: { texte: string; variante: 'neutral' | 'danger' } | null =
    motif !== null
      ? { texte: texteMotifLectureSeule(motif), variante: 'neutral' }
      : !ecriturePossible
        ? { texte: TEXTES.ecritureBloquee, variante: 'danger' }
        : null

  // Colonne de gauche : MÊME source que /messages (3 requêtes fixes).
  const conversations = await listerConversations(session.userId, role)

  // DAL → MessageAffiche (contrat SA-4/SA-6) : date ISO sérialisée.
  const messagesInitiaux: MessageAffiche[] = page.messages.map((message) => ({
    id: message.id,
    contenu: message.contenu,
    emetteurId: message.emetteurId,
    createdAt: message.createdAt.toISOString(),
  }))

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row">
      {/* Rail des conversations : desktop uniquement (hidden lg:flex). */}
      <aside className="hidden min-w-0 lg:flex lg:max-h-[calc(100vh-8rem)] lg:w-80 lg:flex-col">
        <ListeConversations
          conversations={conversations}
          filtre="toutes"
          conversationActiveId={id}
        />
      </aside>

      {/* Colonne principale : toujours min-w-0 (aucun scroll horizontal). */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <EnTeteConversation
          // Vague 3 : `bloqueeParMoi` forwardé jusqu'à ActionsConversation —
          // le bascule Bloquer/Débloquer reflète la vérité de la RSC (aucun
          // état de blocage n'est dupliqué côté client).
          titre={conversation.autre.nom}
          statut={conversation.statutCandidature}
          conversationId={id}
          autreUserId={conversation.autre.userId}
          autreNom={conversation.autre.nom}
          bloqueeParMoi={bloqueeParMoi}
        />

        {bandeau !== null ? (
          <BandeauConversation texte={bandeau.texte} variante={bandeau.variante} />
        ) : null}

        <FilMessages
          conversationId={id}
          monUserId={conversation.moi.userId}
          messagesInitiaux={messagesInitiaux}
          plusAncienInitial={page.aPlusAncien}
          lectureSeuleInitial={!ecriturePossible}
        />

        {ecriturePossible ? <ComposerEnvoi conversationId={id} /> : null}
      </div>
    </div>
  )
}
