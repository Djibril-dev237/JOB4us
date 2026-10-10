import 'server-only'

import { Prisma } from '@prisma/client'
import type { StatutCandidature, StatutOffre } from '@prisma/client'

import { prisma } from '@/lib/prisma'

// ─── Couche d'accès aux données de la MESSAGERIE (M8, Vague 1) ──────────────
//
// Contrat central : une conversation appartient à UNE candidature, et ses
// participants se DÉRIVENT de cette candidature (candidat postulant +
// propriétaire courant de l'offre). Aucune table de participants n'est
// copiée : rien à désynchroniser, et surtout le contrôle d'appartenance
// tombe dans le MÊME `where` que la lecture — jamais une lecture puis une
// seconde vérification, qui laisserait une fenêtre de course (TOCTOU) et
// exposerait deux chemins d'erreur distincts.
//
// SÉCURITÉ — 404 indiscernable : `null` est rendu dans TOUS les cas non
// trouvés (conversation inexistante, conversation d'autrui). L'appelant
// (page/action de la Vague 2) ne peut pas distinguer « pas la mienne » de
// « n'existe pas » : distinguer reviendrait à révéler l'existence des
// conversations d'autrui (énumération /messages/1, 2, 3…). Jamais de 403,
// jamais de message différencié. La page rend la 404 globale.
//
// PERF — N+1 interdit : `listerConversations` a un nombre de requêtes FIXE
// (3), quel que soit le nombre de conversations : aucune requête par ligne.
// Le compromis (3 requêtes, comptage des non-lus EN MÉMOIRE) est documenté
// sur la fonction.
//
// ÉCRITURES — strictement limitées à `ConversationEtat` (accusé de lecture
// `luLe`, masquage `masqueLe`) : les messages sont append-only et la
// conversation/candidature ne sont JAMAIS mutés depuis ce module.
//
// Ce module alimente les pages/actions de la Vague 2 (et leur test de
// sécurité) — jamais le client, jamais un composant RSC sans vérification
// de session préalable (c'est l'appelant qui pose `userId` = session).
// ---------------------------------------------------------------------------

/** Taille d'une page de messages (constante EXPORTÉE : pagination testable). */
export const PAGE = 30

// ─── Contrats de retour (API figée — les vagues suivantes codent dessus) ────

/** Un participant d'une conversation : dérivé de la candidature, jamais stocké. */
export interface Participant {
  userId: number
  role: 'candidat' | 'recruteur'
  nom: string
}

export interface ConversationOuverte {
  id: number
  candidatureId: number
  statutCandidature: StatutCandidature
  offreId: number
  /** VRAI si statut 'publiee' ET deletedAt null, sinon null — jamais de fuite. */
  titreOffre: string | null
  moi: Participant
  autre: Participant
}

export interface LigneListe {
  conversationId: number
  nomInterlocuteur: string
  /** Même règle que `ConversationOuverte.titreOffre`. */
  titreOffre: string | null
  statutCandidature: StatutCandidature
  /** Contenu COMPLET : la troncature visuelle appartient au composant. */
  dernierMessage: { contenu: string; emetteurId: number; createdAt: Date } | null
  nonLus: number
}

export interface PageMessages {
  /** Ordre chronologique CROISSANT (du plus ancien au plus récent). */
  messages: { id: number; contenu: string; emetteurId: number; createdAt: Date }[]
  /** true si une page avant celle-ci existe (il reste plus ancien). */
  aPlusAncien: boolean
}

// ─── Briques partagées (participants + anti-fuite de titre) ─────────────────

/**
 * `where` d'AUTHORISATION porté par la LECTURE elle-même : l'id de la
 * conversation ET l'appartenance (candidat de la candidature, OU propriétaire
 * de l'offre de la candidature) sont les clauses de la MÊME requête. Aucune
 * seconde interrogation possible : un seul `findFirst`, un seul verdict.
 */
function whereParticipant(conversationId: number, userId: number): Prisma.ConversationWhereInput {
  return {
    id: conversationId,
    candidature: {
      OR: [{ candidat: { userId } }, { offre: { entreprise: { userId } } }],
    },
  }
}

/**
 * Include complet des participants : la candidature porte son candidat ET
 * l'offre de SON entreprise (le propriétaire courant — le recruteur d'une
 * conversation n'est PAS figé à la création, il suit le propriétaire actuel
 * de l'offre). UNE jointure, zéro requête supplémentaire par champ.
 */
const INCLUDE_CANDIDATURE = {
  candidature: {
    include: {
      offre: { include: { entreprise: { include: { user: true } } } },
      candidat: { include: { user: true } },
    },
  },
} satisfies Prisma.ConversationInclude

type ConversationChargee = Prisma.ConversationGetPayload<{ include: typeof INCLUDE_CANDIDATURE }>

/**
 * Participants dérivés d'une candidature chargée : le `where` participant
 * garantit que `userId` appartient à l'un des deux rôles. En cas de compte
 * satisfaisant les deux (cas limite : un recruteur qui postule à sa propre
 * offre), le rôle CANDIDAT l'emporte — arbitrage déterministe, jamais
 * d'erreur, jamais de compte « double » dans la réponse.
 */
function participantsDe(
  candidature: ConversationChargee['candidature'],
  userId: number,
): { moi: Participant; autre: Participant } {
  const candidat: Participant = {
    userId: candidature.candidat.user.id,
    role: 'candidat',
    nom: candidature.candidat.user.name,
  }
  const recruteur: Participant = {
    userId: candidature.offre.entreprise.user.id,
    role: 'recruteur',
    nom: candidature.offre.entreprise.user.name,
  }

  return candidature.candidat.user.id === userId
    ? { moi: candidat, autre: recruteur }
    : { moi: recruteur, autre: candidat }
}

/**
 * Titre affichable : UNIQUEMENT si l'offre est `publiee` ET non supprimée
 * logiquement. Une offre en brouillon, clôturée, SUSPENDUE ou supprimée ne
 * doit jamais fuir son titre à travers la messagerie (la messagerie est
 * un canal latéral : elle ne contourne pas les règles de visibilité M5/M6).
 */
function titreAffichable(offre: { titre: string; statut: StatutOffre; deletedAt: Date | null }): string | null {
  return offre.statut === 'publiee' && offre.deletedAt === null ? offre.titre : null
}

// ─── Lecture d'une conversation ─────────────────────────────────────────────

/**
 * Conversation ouverte PAR UN PARTICIPANT : existence + participation dans
 * LA MÊME `findFirst` (voir `whereParticipant`). `null` dans TOUS les cas
 * non trouvés, strictement indiscernable — l'appelant rend la 404 globale.
 *
 * 1 requête (PK `id`, puis la jointure de filtre candidature) + les
 * jointures de lecture incluses : aucun N+1, aucune écriture.
 */
export async function chargerConversation(
  conversationId: number,
  userId: number,
): Promise<ConversationOuverte | null> {
  const conversation = await prisma.conversation.findFirst({
    where: whereParticipant(conversationId, userId),
    include: INCLUDE_CANDIDATURE,
  })

  if (conversation === null) {
    return null
  }

  const { moi, autre } = participantsDe(conversation.candidature, userId)

  return {
    id: conversation.id,
    candidatureId: conversation.candidatureId,
    statutCandidature: conversation.candidature.statut,
    offreId: conversation.candidature.offreId,
    titreOffre: titreAffichable(conversation.candidature.offre),
    moi,
    autre,
  }
}

// ─── Liste « mes conversations » ────────────────────────────────────────────

/**
 * Filtre de participation selon le rôle du COMPTE (pas selon un rôle stocké) :
 * le candidat est identifié par `candidature.candidat.userId`, le recruteur
 * par le propriétaire courant `candidature.offre.entreprise.userId`.
 */
function filtreRole(userId: number, role: 'candidat' | 'recruteur'): Prisma.ConversationWhereInput {
  return role === 'candidat'
    ? { candidature: { candidat: { userId } } }
    : { candidature: { offre: { entreprise: { userId } } } }
}

/**
 * Conversations visibles par un compte, en nombre de requêtes FIXE (3),
 * quel que soit le nombre de conversations — N+1 strictement interdit :
 *
 *   1) `findMany Conversation` : participation (rôle) + exclusion des
 *      conversations MASQUÉES de mon côté, avec la candidature enrichie et
 *      le dernier message (orderBy createdAt DESC take 1) ;
 *   2) `findMany ConversationEtat` pour MOI sur ces ids → `luLe` par
 *      conversation (map en mémoire) ;
 *   3) `findMany Message` des SEULS expéditeurs AUTRES que moi sur ces ids
 *      (select minimal `conversationId`/`createdAt`) → `nonLus` compté EN
 *      MÉMOIRE : un message compte s'il est plus récent que `luLe` (luLe
 *      null → tout compte).
 *
 * Compromis assumé (3 requêtes fixes) : le comptage des non-lus ne pousse
 * pas un compteur en base (pas de trigger, pas de dénormalisation à
 * maintenir) ; en contrepartie on transfère `messages` (2 colonnes) au lieu
 * d'un `count` par conversation — ce qui éviterait JUSTEMENT un N+1, mais
 * multiplierait les allers-retours SQL par le nombre de conversations
 * ouvertes. 3 requêtes bornées, prévisible, index `messages_conv_created_idx`
 * en tête de colonne : c'est le meilleur rapport coût/simplicité à ce
 * volume. Si la messagerie grossit au point que ce transfert pèse, la
 * prochaine étape est un compteur dénormalisé `nonLus` sur `ConversationEtat`
 * (écriture à l'envoi + à l'accusé de lecture) — PAS un comptage par ligne.
 *
 * `titreOffre` suit la même règle d'anti-fuite que `chargerConversation`.
 * Tri : conversation la plus récente d'abord (`id` décroissant — l'id
 * auto-incrémenté ordonne la création).
 */
export async function listerConversations(
  userId: number,
  role: 'candidat' | 'recruteur',
): Promise<LigneListe[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      ...filtreRole(userId, role),
      // Masquées de mon côté : `masqueLe non null POUR MOI` = exclue. Le
      // masquage est INDIVIDUEL (chaque participant masque de son côté) —
      // le masque de l'autre ne doit donc m'exclure de rien.
      etats: { none: { userId, masqueLe: { not: null } } },
    },
    include: {
      ...INCLUDE_CANDIDATURE,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { contenu: true, senderId: true, createdAt: true },
      },
    },
    orderBy: { id: 'desc' },
  })

  // Liste vide : 1 seule requête, on n'interroge ni les états ni les
  // messages sur un `IN ()` vide (inutile et potentiellement coûteux).
  if (conversations.length === 0) {
    return []
  }

  const ids = conversations.map((conversation) => conversation.id)

  // Requête 2 : mon état (luLe + masqueLe) par conversation — UNE findMany
  // pour toutes. Cette unique ligne sert deux usages : la map `luLe` du
  // comptage ET la DÉFENSE EN PROFONDEUR du masquage.
  const mesEtats = await prisma.conversationEtat.findMany({
    where: { userId, conversationId: { in: ids } },
    select: { conversationId: true, luLe: true, masqueLe: true },
  })
  const etatsParConversation = new Map<number, { luLe: Date | null; masqueLe: Date | null }>()
  for (const etat of mesEtats) {
    etatsParConversation.set(etat.conversationId, { luLe: etat.luLe, masqueLe: etat.masqueLe })
  }

  // Exclusion des masquées : le `where` (requête 1) les a déjà retirées
  // côté base (perf, index `conv_etat_user_masque_idx`), mais on RE-vérifie
  // en mémoire sur mes propres états — défense en profondeur : masquer est
  // un droit du participant, jamais une donnée à laquelle il doit pouvoir
  // accéder par accident. Le masque de l'autre ne m'exclut de rien (je ne
  // regarde QUE ma ligne).
  const visibles = conversations.filter(
    (conversation) => (etatsParConversation.get(conversation.id)?.masqueLe ?? null) === null,
  )

  // Requête 3 : messages de l'AUTRE (le where porte `senderId not: userId`,
  // d'où le comptage pur en mémoire) — UNE findMany pour les conversations
  // effectivement rendues.
  const idsVisibles = visibles.map((conversation) => conversation.id)
  const messagesAutres = await prisma.message.findMany({
    where: { conversationId: { in: idsVisibles }, senderId: { not: userId } },
    select: { conversationId: true, createdAt: true },
  })
  const nonLusParConversation = new Map<number, number>()
  for (const message of messagesAutres) {
    const luLe = etatsParConversation.get(message.conversationId)?.luLe ?? null
    // luLe null → rien n'a jamais été lu : tout message de l'autre compte.
    if (luLe === null || message.createdAt > luLe) {
      nonLusParConversation.set(
        message.conversationId,
        (nonLusParConversation.get(message.conversationId) ?? 0) + 1,
      )
    }
  }

  return visibles.map((conversation) => {
    const candidature = conversation.candidature
    const dernier = conversation.messages[0] ?? null
    const interlocuteur =
      role === 'candidat' ? candidature.offre.entreprise.user : candidature.candidat.user

    return {
      conversationId: conversation.id,
      nomInterlocuteur: interlocuteur.name,
      titreOffre: titreAffichable(candidature.offre),
      statutCandidature: candidature.statut,
      dernierMessage:
        dernier === null
          ? null
          : { contenu: dernier.contenu, emetteurId: dernier.senderId, createdAt: dernier.createdAt },
      nonLus: nonLusParConversation.get(conversation.id) ?? 0,
    }
  })
}

// ─── Pagination des messages (curseur temporel) ─────────────────────────────

/**
 * Page de messages d'une conversation, PAR UN PARTICIPANT : même `where`
 * d'autorisation que `chargerConversation`, dans LA MÊME requête — un
 * non-participant reçoit `null`, indiscernable d'une conversation inexistante
 * (404 globale côté appelant).
 *
 * Curseur = `createdAt` du message le plus ancien déjà rendu ; on demande
 * `PAGE + 1` bruts en ordre DÉCROISSANT (index `messages_conv_created_idx`
 * en tête de colonne, pas de filesort) : le +1 sert UNIQUEMENT à détecter
 * l'existence d'une page avant (`aPlusAncien`), puis la page est tronquée à
 * `PAGE` et renversée pour l'ordre CROISSANT rendu au composant.
 */
export async function lireMessagesParCurseur(
  conversationId: number,
  userId: number,
  curseur: Date | null,
): Promise<PageMessages | null> {
  const conversation = await prisma.conversation.findFirst({
    where: whereParticipant(conversationId, userId),
    include: {
      messages: {
        // Pagination stricte : STRICTEMENT avant le curseur (`lt`), jamais
        // `lte` — sinon le message-curser serait rendu deux fois de suite.
        where: curseur === null ? undefined : { createdAt: { lt: curseur } },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
      },
    },
  })

  if (conversation === null) {
    return null
  }

  const bruts = conversation.messages
  const aPlusAncien = bruts.length > PAGE

  // DESC → ASC (renversement en mémoire, aucun second ORDER BY SQL), puis
  // troncature : on garde les PAGE plus RÉCENTS de la fenêtre (ceux
  // adjacents au curseur, ce qui interdit toute lacune à la jonction des
  // pages), le 31e — le plus ancien — n'existant que pour prouver qu'une
  // page plus ancienne existe (aPlusAncien).
  const page = bruts
    .slice(0, PAGE)
    .reverse()
    .map((message) => ({
      id: message.id,
      contenu: message.contenu,
      emetteurId: message.senderId,
      createdAt: message.createdAt,
    }))

  return { messages: page, aPlusAncien }
}

// ─── Accusé de lecture (ConversationEtat uniquement) ────────────────────────

/**
 * Avance `luLe` au dernier message de la conversation, SEULEMENT s'il
 * progresse (CAS anti-course) : l'appelant (action Vague 2) a déjà vérifié
 * la participation via `chargerConversation` dans la MÊME requête serveur.
 *
 * `true` = un avancement a réellement eu lieu (l'action déclenchera
 * l'événement messageLu) ; `false` = rien à faire (déjà lu, ou conversation
 * sans message). Une écriture zéro-utile est un UPDATE qu'on évite.
 *
 * 1) dernier message (select minimal) ; aucun → `false`, ZÉRO écriture ;
 * 2) `updateMany` CAS : le `where` porte l'avancement (`luLe null` OU
 *    `luLe < dernier`) — deux appels concurrents ne peuvent pas régresser
 *    luLe ni compter deux avancements : la condition vit DANS la requête ;
 * 3) count 0 = peut-être AUCUNE ligne d'état (première lecture) → create ;
 *    un create concurrent perd la course sur la clé composite → P2002,
 *    ciblé ici, retente l'updateMany CAS une fois. Présence avérée + count 0
 *    = déjà à jour → `false`.
 */
export async function avancerLecture(conversationId: number, userId: number): Promise<boolean> {
  const dernier = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  if (dernier === null) {
    return false
  }

  if (await avancerLuLe(conversationId, userId, dernier.createdAt)) {
    return true
  }

  const etat = await prisma.conversationEtat.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { conversationId: true },
  })

  if (etat !== null) {
    // La ligne existe et le CAS n'a rien pris : luLe est DÉJÀ au dernier
    // message. Faux avancement : aucun événement, aucune écriture.
    return false
  }

  try {
    await prisma.conversationEtat.create({
      data: { conversationId, userId, luLe: dernier.createdAt },
    })
    return true
  } catch (erreur) {
    // P2002 ciblé UNIQUEMENT : création concurrente de MA ligne (clé
    // composite conversationId+userId). On retente l'updateMany CAS — qui
    // décidera lui-même s'il y a progrès. Aucun catch généraliste : une
    // autre erreur (réseau, contrainte…) remonte telle quelle.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      return avancerLuLe(conversationId, userId, dernier.createdAt)
    }
    throw erreur
  }
}

/** CAS d'avancement de `luLe` : la progressivité est portée par le `where`. */
async function avancerLuLe(
  conversationId: number,
  userId: number,
  dernier: Date,
): Promise<boolean> {
  const { count } = await prisma.conversationEtat.updateMany({
    where: {
      conversationId,
      userId,
      OR: [{ luLe: null }, { luLe: { lt: dernier } }],
    },
    data: { luLe: dernier },
  })

  return count > 0
}

/**
 * Masque la conversation de MON côté (idempotent) : upsert sur la clé
 * composite, `masqueLe = maintenant`. Aucune vérification de participation
 * ici non plus — l'appelant (action Vague 2) vérifie d'abord via
 * `chargerConversation`, qui rend le 404 indiscernable. Masquer ne change
 * RIEN pour l'autre participant : son `masqueLe` est une autre ligne.
 */
export async function poserMasque(conversationId: number, userId: number): Promise<void> {
  const maintenant = new Date()

  await prisma.conversationEtat.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    create: { conversationId, userId, masqueLe: maintenant },
    update: { masqueLe: maintenant },
  })
}
