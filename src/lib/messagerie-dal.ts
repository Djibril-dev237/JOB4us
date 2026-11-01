import 'server-only'

import { Prisma } from '@prisma/client'
import type { StatutCandidature, StatutOffre } from '@prisma/client'

import { TEXTE_MESSAGE_MASQUE } from '@/lib/moderation-labels'
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
// ÉCRITURES — deux familles : `ConversationEtat` (accusé de lecture `luLe`,
// masquage `masqueLe`) pour la Vague 2, puis BLOCAGE et SIGNALEMENT (Vague 3)
// qui écrivent leur propre table. Les messages restent append-only et la
// conversation/candidature ne sont JAMAIS mutés depuis ce module.
//
// Ce module alimente les pages/actions de la Vague 2 (et leur test de
// sécurité) — jamais le client, jamais un composant RSC sans vérification
// de session préalable (c'est l'appelant qui pose `userId` = session).
// ---------------------------------------------------------------------------

/** Taille d'une page de messages (constante EXPORTÉE : pagination testable). */
export const PAGE = 30

/**
 * Identifiants des messages dont la DERNIÈRE ligne de modération est un
 * masquage. Une requête pour toute la page, jamais une par message. Le
 * journal est append-only : la ligne la plus récente (createdAt, id) décide.
 */
async function idsMessagesMasques(messageIds: number[]): Promise<Set<number>> {
  if (messageIds.length === 0) return new Set()
  const lignes = await prisma.messageModeration.findMany({
    where: { messageId: { in: messageIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { messageId: true, action: true },
  })
  const derniereParMessage = new Map<number, 'masquage' | 'retablissement'>()
  for (const ligne of lignes) {
    if (!derniereParMessage.has(ligne.messageId)) {
      derniereParMessage.set(ligne.messageId, ligne.action)
    }
  }
  return new Set(
    [...derniereParMessage.entries()]
      .filter(([, action]) => action === 'masquage')
      .map(([messageId]) => messageId),
  )
}

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
 * Appartenance d'une CANDIDATURE à un compte : candidat postulant, OU
 * propriétaire courant de l'offre. Extrait pour être réutilisé tel quel par
 * `ecrireSignalement` (Vague 3) — une participation qui se dérive DU AUTRE
 * CÔTÉ d'une relation (ici : message → conversation → candidature) doit
 * poser EXACTEMENT les mêmes clauses, sinon le signalement autoriserait ce
 * que la lecture refuse.
 */
function ouCandidatOuProprietaire(userId: number): Prisma.CandidatureWhereInput {
  return { OR: [{ candidat: { userId } }, { offre: { entreprise: { userId } } }] }
}

/**
 * `where` d'AUTHORISATION porté par la LECTURE elle-même : l'id de la
 * conversation ET l'appartenance (candidat de la candidature, OU propriétaire
 * de l'offre de la candidature) sont les clauses de la MÊME requête. Aucune
 * seconde interrogation possible : un seul `findFirst`, un seul verdict.
 */
function whereParticipant(conversationId: number, userId: number): Prisma.ConversationWhereInput {
  return {
    id: conversationId,
    candidature: ouCandidatOuProprietaire(userId),
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
        select: { id: true, contenu: true, senderId: true, createdAt: true },
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

  // Requête 4 : masquages des aperçus. L'aperçu est un contenu comme un
  // autre : un message masqué ne doit jamais réapparaître dans la liste.
  const idsApercus = visibles
    .map((conversation) => conversation.messages[0]?.id)
    .filter((id): id is number => typeof id === 'number')
  const masques = await idsMessagesMasques(idsApercus)

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
          : {
              contenu: masques.has(dernier.id) ? TEXTE_MESSAGE_MASQUE : dernier.contenu,
              emetteurId: dernier.senderId,
              createdAt: dernier.createdAt,
            },
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
  const page = bruts.slice(0, PAGE).reverse()

  // Requête 2 : masquages de la page. Le contenu d'origine ne quitte jamais
  // la base pour un participant ; le texte neutre est la seule valeur rendue.
  const masques = await idsMessagesMasques(page.map((message) => message.id))

  return {
    messages: page.map((message) => ({
      id: message.id,
      contenu: masques.has(message.id) ? TEXTE_MESSAGE_MASQUE : message.contenu,
      emetteurId: message.senderId,
      createdAt: message.createdAt,
    })),
    aPlusAncien,
  }
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

// ─── Blocage d'un interlocuteur (Vague 3) ────────────────────────────────────
//
// Le blocage est GLOBAL par acteurs (Étape 2 §5) : une ligne (bloqueurId,
// bloqueId) vaut pour toutes les conversations passées et futures entre les
// deux comptes — aucune conversation n'est refermée une par une, rien à
// synchroniser. La table porte une clé unique sur la paire : la deuxième
// écriture de la même paire est un P2002, absorbé ici pour rendre l'opération
// idempotente (deux clics, deux onglets, retry réseau : jamais d'erreur
// visible, jamais de doublon).
//
// AUCUNE vérification de participation ni de « pas soi-même » ici : la cible
// est un `userId`, pas une conversation, et le contrôle d'appelant (session,
// pas d'auto-blocage) appartient à l'action Vague 3 qui appelle ce module —
// même séparation DAL/action que `poserMasque`.

/**
 * Pose le blocage `bloqueurId → bloqueId` (idempotent) : le create, puis le
 * P2002 de la clé unique absorbé en silence (la ligne existe déjà, le voulu
 * est atteint). Toute AUTRE erreur DB remonte telle quelle (l'appelant rend
 * la panne générique) — aucun catch généraliste qui masquerait une vraie panne.
 */
export async function poserBlocage(bloqueurId: number, bloqueId: number): Promise<void> {
  try {
    await prisma.blocage.create({ data: { bloqueurId, bloqueId } })
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      return
    }
    throw erreur
  }
}

/**
 * Lève le blocage `bloqueurId → bloqueId` (idempotent) : `deleteMany` sans
 * condition de présence — 0 ligne supprimée signifie « déjà débloqué », ce
 * n'est PAS une erreur (même verdict que le déblocage réel côté appelant).
 */
export async function leverBlocage(bloqueurId: number, bloqueId: number): Promise<void> {
  await prisma.blocage.deleteMany({ where: { bloqueurId, bloqueId } })
}

// ─── Signalement d'un message (Vague 3) ──────────────────────────────────────

/**
 * Signale un message au nom de `auteurId` (motif déjà nettoyé par l'action).
 *
 * UNE SEULE `findFirst` porte les TROIS conditions d'existence, dans le `where`
 * de la lecture — aucun contrôle après coup (une lecture puis une seconde
 * vérification laisserait une fenêtre de course et révélerait lesquelles ont
 * échoué) :
 *   1. le message existe (id dans la table) ;
 *   2. `auteurId` PARTICIPE à la conversation du message — même dérivation
 *      candidature que `whereParticipant` (`ouCandidatOuProprietaire`), suivie
 *      à travers la relation message → conversation : signaler ne s'ouvre pas
 *      à n'importe qui sur des ids énumérables ;
 *   3. le message n'est PAS signé par `auteurId` lui-même (on ne signale pas
 *      ses propres messages : ce serait un canal d'auto-escalade).
 *
 * `null` = l'un des trois échoue — JAMAIS lequel (pas d'oracle d'énumération,
 * calque du 404 indiscernable de `chargerConversation`). Le verdict détaillé
 * n'a d'ailleurs aucune utilité UI : l'appelant rend la panne générique.
 *
 * Le blocage n'apparaît PAS dans ce `where` : signaler reste la soupape de
 * sécurité des harcèlements, POSSIBLE même bloqué (sinon le blocage couvrirait
 * exactement les cas où la modération doit être saisie).
 *
 * Sans doublon grâce à la clé unique (messageId, auteurId) : le create lève
 * P2002 si ce message a déjà été signalé par ce compte → `'existant'`, et le
 * signalement antérieur reste la vérité (aucun update, aucun overwrite du motif).
 */
export async function ecrireSignalement(
  messageId: number,
  auteurId: number,
  motif: string,
): Promise<'cree' | 'existant' | null> {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      senderId: { not: auteurId },
      conversation: { candidature: ouCandidatOuProprietaire(auteurId) },
    },
    select: { id: true },
  })

  if (message === null) {
    return null
  }

  try {
    await prisma.signalement.create({ data: { messageId, auteurId, motif } })
    return 'cree'
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      return 'existant'
    }
    throw erreur
  }
}
