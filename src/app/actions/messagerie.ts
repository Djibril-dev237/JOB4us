'use server'

import { Prisma } from '@prisma/client'

import { verifySession } from '@/lib/dal'
import {
  messageEnvoye,
  messageLu,
  signalementRecu,
} from '@/lib/evenements-messagerie'
import { nettoyerMessage, nettoyerMotif } from '@/lib/messagerie-contenu'
import {
  avancerLecture,
  chargerConversation,
  ecrireSignalement,
  leverBlocage,
  lireMessagesParCurseur,
  poserBlocage,
  poserMasque,
} from '@/lib/messagerie-dal'
import { estLectureSeule } from '@/lib/messagerie-labels'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import {
  MAX_IDENTIFIANT,
  schemaBloquerUtilisateur,
  schemaEnvoyerMessage,
  schemaMasquerConversation,
  schemaSignalerMessage,
} from '@/lib/messagerie-schemas'
import { prisma } from '@/lib/prisma'
import {
  MESSAGERIE_ENVOI_WINDOW_MS,
  MESSAGERIE_MAX_ENVOIS_PAR_COMPTE,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'

// ─── Actions serveur de la MESSAGERIE (M8, Vague 2) ──────────────────────────
//
// Contrats repris AU MOT de src/app/actions/candidatures.ts (M7) :
//
// * SESSION : acquisition miroir du pattern M7 (`verifySession` de
//   src/lib/dal.ts, lecture seule `session.userId`) — mais SANS `verifyRole`,
//   car le verdict diffère : ici un admin (ou rôle inattendu) reçoit la panne
//   GÉNÉRIQUE (`inconnue` / `null` / sortie silencieuse), jamais une
//   redirection `/unauthorized` qui révélerait qu'un autre rôle existe sur
//   cette ressource. Un visiteur non connecté garde le redirect /login du DAL
//   (miroir exact M7).
//
// * ORDRE DE CONTRÔLE DE `envoyerMessage` (chaque échec précoce = zéro effet
//   de bord, zéro seau consommé) :
//     1) session + rôle admis        → `inconnue`
//     2) forme du payload (Zod .strict()) → `inconnue`
//     3) nettoyage + non-vidité      → `inconnue`
//     4) participation (404 indiscernable du DAL) → `inconnue`
//     5) lecture seule (statut terminal) → `lecture-seule`
//     6) blocage dans l'un ou l'autre sens → `bloquee`
//     7) seau du compte              → `debit`
//     8) écriture, PUIS `recordAttempt`, PUIS événement → succès
//     9) catch ciblé : log SANS donnée personnelle, verdict `inconnue`
//   Échecs 1→6 : AUCUNE écriture et AUCUN seau consommé — un refus de
//   conversation fermée ou d'autrui ne doit jamais brûler le budget d'une
//   minute d'un utilisateur légitime (doctrine M6/M7 reconduite).
//
// * 404 INDISCERNABLE : `chargerConversation` rend `null` pour une
//   conversation inexistante ET pour celle d'autrui ; les deux partagent le
//   MÊME verdict `inconnue` — aucun oracle d'énumération (/messages/1, 2, 3…).
//
// * SEAU PAR ACTEUR (`messagerie:envoi:<userId>`), jamais par conversation :
//   ouvrir plusieurs onglets ou conversations ne multiplie pas le budget.
//   `recordAttempt` APRÈS l'écriture réelle uniquement.
//
// * JAMAIS d'exception brute ne sort d'une action : `envoyerMessage` renvoie
//   `inconnue`, `marquerConversationLue` avale tout (best-effort, cf. sa
//   doc) — aucune Stack Trace Prisma ne peut atteindre le client.
//
// VAGUE 3 (modération côté candidat/recruteur) — mêmes disciplines, périmètre
// réduit :
//   * `signalerMessage` : session → schema → nettoyage du motif →
//     `ecrireSignalement` (le DAL porte les 3 contrôles d'existence dans UNE
//     requête) → verdict. AUCUN seau (l'Étape 2 ne l'impose que pour l'envoi
//     de messages) et un seul hook M9 (`signalementRecu`, branché vers son
//     résolveur) : le signalement notifie les admins en interne (pointeurs
//     seuls, jamais le motif) et alimente la file de modération. Surtout,
//     JAMAIS testé contre le blocage : signaler est la soupape de sécurité
//     des harcèlements, elle doit rester ouverte même quand l'interlocuteur
//     m'a bloqué (sinon le blocage couvrirait exactement les cas où la
//     modération doit être saisie).
//   * `bloquerUtilisateur` / `debloquerUtilisateur` : session → schema →
//     PAS d'auto-blocage (la cible = moi est un refus, jamais une écriture)
//     → DAL idempotent. Le blocage est GLOBAL par acteurs : il n'a pas besoin
//     de la participation à une conversation particulière, donc AUCUNE
//     lecture de conversation ici (contrairement à `masquerConversation`).
// ---------------------------------------------------------------------------

/** Rôles admis en messagerie : l'admin n'a PAS accès au canal privé. */
function estRoleMessagerie(role: string): role is 'candidat' | 'recruteur' {
  return role === 'candidat' || role === 'recruteur'
}

/**
 * Session de messagerie : `userId` de la session, ou `null` si le compte
 * n'a pas le droit d'atteindre la messagerie (admin, rôle inattendu).
 * Un non-connecté redirige /login depuis le DAL (miroir M7).
 */
async function sessionMessagerie(): Promise<{ userId: number } | null> {
  const session = await verifySession()
  if (!estRoleMessagerie(session.role)) {
    return null
  }
  return { userId: session.userId }
}

/** Clé du seau M8 : portée par le COMPTE, jamais par la conversation. */
function cleSeauEnvoi(userId: number): string {
  return `messagerie:envoi:${userId}`
}

export type ResultatEnvoi =
  | { ok: true; message: MessageAffiche }
  | { ok: false; erreur: 'lecture-seule' | 'bloquee' | 'taille' | 'debit' | 'inconnue' }

/**
 * Envoie un message dans une conversation (candidat OU recruteur).
 *
 * Voir l'en-tête du fichier pour l'ordre strict des 9 contrôles. La forme
 * du payload est validée par `schemaEnvoyerMessage` (`.strict()` : une clé
 * forgée — `senderId`, `emetteurId`, `statut`… — fait échouer le parse) ;
 * le NETTOYAGE (balises, caractères de contrôle, troncature) appartient à
 * l'action via `nettoyerMessage` (règle des deux temps, messagerie-schemas).
 * L'identité de l'expéditeur sort TOUJOURS de la session, jamais du payload.
 */
export async function envoyerMessage(payload: {
  conversationId: number
  contenu: string
}): Promise<ResultatEnvoi> {
  // 1) Session + rôle admis : un admin reçoit la panne générique, et le
  //    reste de l'action n'est même pas interrogé.
  const session = await sessionMessagerie()
  if (session === null) {
    return { ok: false, erreur: 'inconnue' }
  }
  const userId = session.userId

  // 2) Forme du payload : entier positif + chaîne bornée à la garde BRUTE,
  //    clés inconnues refusées. `conversationId: 'x'` meurt ici.
  const parse = schemaEnvoyerMessage.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  // 3) Nettoyage : un message réduit à du blanc après retrait des balises
  //    n'est pas un contenu — refus AVANT toute lecture ni écriture.
  const contenuPropre = nettoyerMessage(payload.contenu)
  if (contenuPropre === '') {
    return { ok: false, erreur: 'inconnue' }
  }

  try {
    // 4) Participation : LA même requête porte l'id ET l'appartenance —
    //    `null` = inexistante OU d'autrui, verdict unique (404 indiscernable).
    const conversation = await chargerConversation(parse.data.conversationId, userId)
    if (conversation === null) {
      return { ok: false, erreur: 'inconnue' }
    }

    // 5) Lecture seule : les 3 statuts terminaux figent la conversation des
    //    deux côtés (motifLectureSeule de messagerie-labels, source unique).
    if (estLectureSeule(conversation.statutCandidature)) {
      return { ok: false, erreur: 'lecture-seule' }
    }

    // 6) Blocage : DANS LES DEUX SENS — que je l'aie bloqué ou qu'il m'ait
    //    bloqué, plus aucune écriture. Un seul findFirst, deux clauses OR.
    const blocage = await prisma.blocage.findFirst({
      where: {
        OR: [
          { bloqueurId: userId, bloqueId: conversation.autre.userId },
          { bloqueurId: conversation.autre.userId, bloqueId: userId },
        ],
      },
      select: { id: true },
    })
    if (blocage !== null) {
      return { ok: false, erreur: 'bloquee' }
    }

    // 7) Seau du compte : vérifié APRÈS le périmètre (les refus de droits ne
    //    consomment pas) et AVANT l'écriture (un spammeur n'atteint jamais
    //    la base une fois à sec).
    const cleSeau = cleSeauEnvoi(userId)
    if (!checkRateLimit(cleSeau, MESSAGERIE_MAX_ENVOIS_PAR_COMPTE, MESSAGERIE_ENVOI_WINDOW_MS).allowed) {
      return { ok: false, erreur: 'debit' }
    }

    // 8) Écriture réelle, puis consommation du seau (jamais l'inverse : une
    //    tentative qui échoue en base ne doit pas brûler de budget), puis
    //    événement M9 (pointeurs d'ids seulement, jamais le contenu).
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        contenu: contenuPropre,
      },
    })
    recordAttempt(cleSeau, MESSAGERIE_ENVOI_WINDOW_MS)
    messageEnvoye({
      conversationId: conversation.id,
      messageId: message.id,
      emetteurId: userId,
    })

    return {
      ok: true,
      message: {
        id: message.id,
        contenu: message.contenu,
        emetteurId: message.senderId,
        createdAt: message.createdAt.toISOString(),
      },
    }
  } catch (erreur) {
    // 9) Erreur DB inattendue (panne, FK, timeout) : le code Prisma est utile
    //    au diagnostic, le CONTENU et l'identité ne le sont JAMAIS — on ne
    //    journalise ni message, ni nom, ni email. `erreur.code` n'existe que
    //    sur les erreurs connues Prisma : ailleurs, un libellé neutre.
    const code = erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[messagerie] envoi', { conversationId: payload.conversationId, code })
    return { ok: false, erreur: 'inconnue' }
  }
}

/**
 * Page de messages plus anciens (paginage par curseur temporel), PAR UN
 * PARTICIPANT : non admis (rôle), conversationId invalide, curseur non
 * parsable ou conversation d'autrui → `null` PARTOUT (404 globale côté page,
 * aucun verdict différencié côté client). Les `Date` du DAL sont sérialisées
 * en ISO ici, au bord du serveur — le client ne reçoit que des strings.
 */
export async function chargerMessagesAnciens(
  conversationId: number,
  curseur: string,
): Promise<{ messages: MessageAffiche[]; aPlusAncien: boolean } | null> {
  const session = await sessionMessagerie()
  if (session === null) {
    return null
  }
  // Entier STRICT : un id fractionnaire, négatif ou hors Int32 ne mérite
  // même pas une requête — même verdict qu'une conversation absente (un id
  // géant ferait échouer Prisma hors de toute gestion : critère « zéro 500 »).
  if (!Number.isInteger(conversationId) || conversationId <= 0 || conversationId > MAX_IDENTIFIANT) {
    return null
  }
  // Curseur : une date ISO mal formée ne doit jamais devenir un `Invalid
  // Date` silencieux dans le where (retournerait n'importe quelle page).
  const dateCurseur = new Date(curseur)
  if (Number.isNaN(dateCurseur.getTime())) {
    return null
  }

  // Lecture best-effort : cette action est appelée par un bouton du fil —
  // aucune erreur DB ne doit s'échapper (même verdict qu'un 404 : `null`,
  // le bouton disparaît proprement).
  try {
    const page = await lireMessagesParCurseur(conversationId, session.userId, dateCurseur)
    if (page === null) {
      return null
    }

    return {
      messages: page.messages.map((message) => ({
        id: message.id,
        contenu: message.contenu,
        emetteurId: message.emetteurId,
        createdAt: message.createdAt.toISOString(),
      })),
      aPlusAncien: page.aPlusAncien,
    }
  } catch {
    return null
  }
}

/**
 * Accusé de lecture (avance `luLe`) : BEST-EFFORT silencieux, calqué sur
 * `marquerConsultee` (M7). Rôle non admis ou id invalide → sortie vide ;
 * `avancerLecture` ne renvoie `false` que si rien n'a bougé (déjà lu,
 * conversation vide) → aucun événement. Surtout, JAMAIS d'exception ne
 * s'échappe : un accusé de lecture qui échoue ne doit pas casser le rendu
 * du fil ni signaler au client qu'une conversation existe ou non.
 */
export async function marquerConversationLue(conversationId: number): Promise<void> {
  try {
    const session = await sessionMessagerie()
    if (session === null) {
      return
    }
    if (!Number.isInteger(conversationId) || conversationId <= 0 || conversationId > MAX_IDENTIFIANT) {
      return
    }

    // Garde PARTICIPANT (invariant « chaque écriture » du DAL) :
    // `avancerLecture` écrit sur la clé (conversationId, userId) de QUI
    // APPELLE — sans cette lecture, n'importe quel compte créerait des
    // lignes d'état sur une conversation d'autrui (ids auto-incrément
    // énumérables, ni seau ni borne). Même bénin, c'est une écriture
    // d'autrui : interdite. Le 404 reste indiscernable (sortie vide).
    const conversation = await chargerConversation(conversationId, session.userId)
    if (conversation === null) {
      return
    }

    const avance = await avancerLecture(conversation.id, session.userId)
    if (avance) {
      messageLu({ conversationId, lecteurId: session.userId })
    }
  } catch {
    // Best-effort : le CAS du DAL a déjà tout verrouillé côté base ; une
    // erreur résiduelle est absorbée sans log (aucune donnée à journaliser
    // ici, aucune décision utilisateur en jeu).
  }
}

/**
 * Masque la conversation DU CÔTÉ de l'appelant (idempotent, non réciproque).
 *
 * Garde PARTICIPANT obligatoire : `poserMasque` n'écrit que sur la clé
 * composite (conversationId, userId), donc un appelant pourrait théoriquement
 * « masquer » une conversation qui n'est pas la sienne — une écriture d'état
 * par un non-participant est interdite, même bénigne. `chargerConversation`
 * rend le 404 indiscernable, puis l'upsert part.
 */
export async function masquerConversation(conversationId: number): Promise<void> {
  const session = await sessionMessagerie()
  if (session === null) {
    return
  }
  const parse = schemaMasquerConversation.safeParse({ conversationId })
  if (!parse.success) {
    return
  }

  const conversation = await chargerConversation(parse.data.conversationId, session.userId)
  if (conversation === null) {
    return
  }

  await poserMasque(conversation.id, session.userId)
}

// ─── Modération côté candidat/recruteur (Vague 3) ────────────────────────────

export type ResultatSignalement =
  | { ok: true; deja: boolean }
  | { ok: false; erreur: 'inconnue' }

/**
 * Signale un message d'une conversation à laquelle je PARTICIPE (candidat ou
 * recruteur ; admin → panne générique).
 *
 * Contrôles dans l'ordre (chaque refus précoce = zéro écriture) :
 *   1) session + rôle admis        → `inconnue`
 *   2) forme du payload (Zod .strict()) → `inconnue`
 *   3) nettoyage + non-vidité du motif  → `inconnue`
 *   4) `ecrireSignalement` : existence + participation + « pas mes propres
 *      messages » dans UNE requête du DAL → `null` = `inconnue` (jamais
 *      LEQUEL des trois a échoué, pas d'oracle), `'existant'` → `{ ok, deja:
 *      true }`, `'cree'` → `{ ok, deja: false }`
 *
 * AUCUN seau : l'Étape 2 n'impose de budget minuté que pour l'envoi de
 * messages ; décourager un signalement légitime par « trop de
 * signalements » protégerait le harceleur, pas la victime. Un SEUL hook
 * M9 : `signalementRecu`, émis UNIQUEMENT sur une création réelle ('cree')
 * — le verdict 'existant' (déjà signalé par ce compte) ne repart jamais,
 * l'idempotence vit dans le verdict du DAL.
 *
 * Le blocage n'est JAMAIS interrogé ici (cf. l'en-tête du fichier).
 */
export async function signalerMessage(payload: {
  messageId: number
  motif: string
}): Promise<ResultatSignalement> {
  // 1) Session + rôle admis : un admin reçoit la panne générique.
  const session = await sessionMessagerie()
  if (session === null) {
    return { ok: false, erreur: 'inconnue' }
  }

  // 2) Forme du payload : `.strict()` refuse une clé forgée (`auteurId`,
  //    `statut`…) — l'identité du signalant sort TOUJOURS de la session.
  const parse = schemaSignalerMessage.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  // 3) Nettoyage : un motif réduit à du blanc après retrait des balises
  //    n'est pas un motif — refus AVANT toute lecture ni écriture.
  const motifPropre = nettoyerMotif(parse.data.motif)
  if (motifPropre === '') {
    return { ok: false, erreur: 'inconnue' }
  }

  try {
    // 4) Les 3 contrôles d'existence vivent dans le `where` du DAL. Le P2002
    //    de la clé unique y est déjà absorbé en `'existant'`.
    const verdict = await ecrireSignalement(parse.data.messageId, session.userId, motifPropre)
    if (verdict === null) {
      return { ok: false, erreur: 'inconnue' }
    }
    if (verdict === 'cree') {
      // Événement M9 (hook branché) : pointeurs seuls — le motif
      // nettoyé et l'identité du signalant ne quittent jamais cette requête.
      signalementRecu({ messageId: parse.data.messageId, auteurId: session.userId })
    }
    return { ok: true, deja: verdict === 'existant' }
  } catch (erreur) {
    // Erreur DB inattendue : le code Prisma est utile au diagnostic, le
    // MOTIF et l'identité ne le sont JAMAIS — on ne journalise que l'id du
    // message (pointeur) et le code.
    const code = erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[messagerie] signalement', { messageId: parse.data.messageId, code })
    return { ok: false, erreur: 'inconnue' }
  }
}

export type ResultatBlocage = { ok: true } | { ok: false; erreur: 'inconnue' }

/**
 * Blocage / déblocage d'un interlocuteur, contrôles communs dans l'ordre :
 *   1) session + rôle admis   → `inconnue`
 *   2) forme de la cible (Zod) → `inconnue`
 *   3) PAS d'auto-blocage : la cible = moi est un refus, jamais une
 *      écriture (un compte ne peut pas se couper du monde en un clic —
 *      et se débloquer soi-même dissimulerait une erreur de jugement).
 *   4) DAL idempotent (`P2002` absorbé côté `poserBlocage`, `deleteMany` à
 *      0 ligne côté `leverBlocage`) → le verdict est le MÊME à chaque
 *      appel : un double clic, un retry réseau ou un blocage déjà posé ne
 *      montrent jamais d'erreur.
 *
 * AUCUNE lecture de participation : le blocage vaut pour toutes les
 * conversations passées ET futures entre les deux acteurs (portée globale,
 * Étape 2 §5) — il ne « dépend » d'aucune conversation en particulier.
 */
async function executerBlocage(
  cibleUserId: number,
  libelle: 'blocage' | 'deblocage',
  ecrire: (bloqueurId: number, bloqueId: number) => Promise<void>,
): Promise<ResultatBlocage> {
  const session = await sessionMessagerie()
  if (session === null) {
    return { ok: false, erreur: 'inconnue' }
  }

  const parse = schemaBloquerUtilisateur.safeParse({ cibleUserId })
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  if (parse.data.cibleUserId === session.userId) {
    return { ok: false, erreur: 'inconnue' }
  }

  try {
    await ecrire(session.userId, parse.data.cibleUserId)
    return { ok: true }
  } catch (erreur) {
    // Même discipline de log que `envoyerMessage` : code Prisma + id cible
    // (pointeur), jamais le nom ni l'email de l'interlocuteur.
    const code = erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error(`[messagerie] ${libelle}`, { cibleUserId: parse.data.cibleUserId, code })
    return { ok: false, erreur: 'inconnue' }
  }
}

/** Bloque un interlocuteur pour toutes les conversations (idempotent). */
export async function bloquerUtilisateur(cibleUserId: number): Promise<ResultatBlocage> {
  return executerBlocage(cibleUserId, 'blocage', poserBlocage)
}

/** Lève le blocage d'un interlocuteur (idempotent). */
export async function debloquerUtilisateur(cibleUserId: number): Promise<ResultatBlocage> {
  return executerBlocage(cibleUserId, 'deblocage', leverBlocage)
}
