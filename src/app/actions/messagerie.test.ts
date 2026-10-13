import type { StatutCandidature, StatutOffre } from '@prisma/client'
import { Prisma } from '@prisma/client'
import type { Prisma as NsPrisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifySession } from '@/lib/dal'
import { messageEnvoye, messageLu } from '@/lib/evenements-messagerie'
import {
  MESSAGERIE_ENVOI_WINDOW_MS,
  MESSAGERIE_MAX_ENVOIS_PAR_COMPTE,
  checkRateLimit,
  recordAttempt,
  resetAttempts,
} from '@/lib/rate-limit'

import { chargerMessagesAnciens, envoyerMessage, marquerConversationLue, masquerConversation } from './messagerie'

// ─── Tests des actions serveur MESSAGERIE (M8, Vague 2) ──────────────────────
// Trois critères verrouillés ici :
// 1. ORDRE DE CONTRÔLE : chaque refus précoce (rôle, forme, nettoyage,
//    participation, lecture seule, blocage) n'a AUCUN effet de bord — zéro
//    `message.create`, zéro seau consommé. Seul un envoi RÉUSSI paie le
//    budget d'une minute (doctrine M6/M7).
// 2. 404 INDISCERNABLE : non-participant ≡ conversation inexistante (même
//    verdict `inconnue`), admin ≡ rôle inattendu (panne générique, jamais un
//    verdict révélateur).
// 3. AUCUNE DONNÉE PERSONNELLE en log : le catch ne journalise que l'id de
//    conversation et le code Prisma — jamais le contenu, jamais l'identité.
//
// Patron repris de candidatures.securite.test.ts : prisma/dal mockés, hooks
// d'événements spyés (no-op réel), Zod et nettoyage tournant POUR DE VRAI.
// DIFFÉRENCE assumée : le SEAU EST RÉEL (en mémoire) — seuls
// `checkRateLimit`/`recordAttempt` sont spyés « call-through », pour prouver
// à la fois le comportement (10 envois puis refus) et l'absence de
// consommation sur un refus. Le DAL messagerie tourne aussi pour de vrai au
// dessus du prisma simulé (chargerConversation, avancerLecture, poserMasque).
// ---------------------------------------------------------------------------

// ─── Types des doubles (aucun `any` : lecture des arguments réels) ───────────

interface ArgsConversationFindFirst {
  where?: NsPrisma.ConversationWhereInput
  include?: NsPrisma.ConversationInclude
}

interface ArgsBlocageFindFirst {
  where?: NsPrisma.BlocageWhereInput
  select?: unknown
}

interface ArgsMessageCreate {
  data: NsPrisma.MessageUncheckedCreateInput
}

interface ArgsMessageFindFirst {
  where?: NsPrisma.MessageWhereInput
  orderBy?: NsPrisma.MessageOrderByWithRelationInput
  select?: unknown
}

interface ArgsEtatUpdateMany {
  where?: NsPrisma.ConversationEtatWhereInput
  data?: NsPrisma.ConversationEtatUpdateManyMutationInput
}

interface ArgsEtatFindUnique {
  where?: { conversationId_userId: { conversationId: number; userId: number } }
  select?: unknown
}

interface ArgsEtatCreate {
  data?: NsPrisma.ConversationEtatUncheckedCreateInput
}

interface ArgsEtatUpsert {
  where?: { conversationId_userId: { conversationId: number; userId: number } }
  create?: NsPrisma.ConversationEtatUncheckedCreateInput
  update?: NsPrisma.ConversationEtatUncheckedUpdateInput
}

// Lignes simulées (payload retourné par le mock, jamais `any`).

interface UserSim {
  id: number
  name: string
}

interface OffreSim {
  id: number
  titre: string
  statut: StatutOffre
  deletedAt: Date | null
  entreprise: { userId: number; user: UserSim }
}

interface CandidatureSim {
  id: number
  offreId: number
  statut: StatutCandidature
  candidat: { userId: number; user: UserSim }
  offre: OffreSim
}

interface MessageSim {
  id: number
  conversationId: number
  senderId: number
  contenu: string
  createdAt: Date
}

interface MessagePageSim {
  id: number
  contenu: string
  senderId: number
  createdAt: Date
}

interface ConversationSim {
  id: number
  candidatureId: number
  candidature: CandidatureSim
}

const {
  conversationFindFirst,
  messageCreate,
  messageFindFirst,
  etatUpdateMany,
  etatFindUnique,
  etatCreate,
  etatUpsert,
  blocageFindFirst,
} = vi.hoisted(() => ({
  conversationFindFirst: vi.fn<(args: ArgsConversationFindFirst) => Promise<unknown>>(),
  messageCreate: vi.fn<(args: ArgsMessageCreate) => Promise<MessageSim>>(),
  messageFindFirst: vi.fn<(args: ArgsMessageFindFirst) => Promise<unknown>>(),
  etatUpdateMany: vi.fn<(args: ArgsEtatUpdateMany) => Promise<{ count: number }>>(),
  etatFindUnique: vi.fn<(args: ArgsEtatFindUnique) => Promise<unknown>>(),
  etatCreate: vi.fn<(args: ArgsEtatCreate) => Promise<unknown>>(),
  etatUpsert: vi.fn<(args: ArgsEtatUpsert) => Promise<unknown>>(),
  blocageFindFirst: vi.fn<(args: ArgsBlocageFindFirst) => Promise<unknown>>(),
}))

// Seules les méthodes utilisées par les actions + le DAL sont exposées : une
// requête imprévue lèverait une TypeError et casserait le test.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: conversationFindFirst },
    message: { create: messageCreate, findFirst: messageFindFirst },
    conversationEtat: {
      updateMany: etatUpdateMany,
      findUnique: etatFindUnique,
      create: etatCreate,
      upsert: etatUpsert,
    },
    blocage: { findFirst: blocageFindFirst },
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

// Seau RÉEL en mémoire : seuls les deux points d'entrée sont spyés
// « call-through » — le comptage observé EST celui du store glissant, et un
// refus prouve qu'aucune entrée n'y a été écrite.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...original,
    checkRateLimit: vi.fn(
      (key: string, max: number, windowMs: number) => original.checkRateLimit(key, max, windowMs),
    ),
    recordAttempt: vi.fn((key: string, windowMs?: number) => original.recordAttempt(key, windowMs)),
  }
})

// Spies exécutant les no-ops réels (M9) : « appelé une fois avec les ids »
// est vérifiable, et aucun verdict ne peut en dépendre.
vi.mock('@/lib/evenements-messagerie', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/evenements-messagerie')>()
  return {
    messageEnvoye: vi.fn(original.messageEnvoye),
    messageLu: vi.fn(original.messageLu),
    conversationCreee: vi.fn(original.conversationCreee),
  }
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 11
const AUTRE_USER_ID = 22
const CONV_ID = 5
const CANDIDATURE_ID = 9
const MESSAGE_ID = 101
const CLE_SEAU = `messagerie:envoi:${USER_ID}`
const MESSAGE_DATE = new Date('2026-03-01T10:00:00.000Z')

/** Base simulée : la conversation lue par le DAL et sa page de messages. */
const base: { conversation: ConversationSim | null; messages: MessagePageSim[] } = {
  conversation: null,
  messages: [],
}

/** Conversation « candidat postulant à une offre publiee » (statut variable). */
function convOuverte(statut: StatutCandidature): ConversationSim {
  return {
    id: CONV_ID,
    candidatureId: CANDIDATURE_ID,
    candidature: {
      id: CANDIDATURE_ID,
      offreId: 3,
      statut,
      candidat: { userId: USER_ID, user: { id: USER_ID, name: 'Awa' } },
      offre: {
        id: 3,
        titre: 'Developpeur back-end',
        statut: 'publiee',
        deletedAt: null,
        entreprise: { userId: AUTRE_USER_ID, user: { id: AUTRE_USER_ID, name: 'ACME' } },
      },
    },
  }
}

type PayloadEnvoi = { conversationId: number; contenu: string }

const PAYLOAD: PayloadEnvoi = { conversationId: CONV_ID, contenu: '<b>Bonjour Awa</b>' }

beforeEach(() => {
  vi.clearAllMocks()

  base.conversation = convOuverte('envoyee')
  base.messages = []

  // Seau réel : chaque test repart d'une fenêtre vide pour CE compte.
  resetAttempts(CLE_SEAU)

  vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
  blocageFindFirst.mockImplementation(async () => null)
  messageFindFirst.mockImplementation(async () => ({ createdAt: MESSAGE_DATE }))
  etatUpdateMany.mockImplementation(async () => ({ count: 1 }))
  etatFindUnique.mockImplementation(async () => null)
  etatCreate.mockImplementation(async () => undefined)
  etatUpsert.mockImplementation(async () => undefined)

  // La double lecture du DAL : include candidature (participation) vs
  // include messages (pagination) — même `findFirst`, deux contrats.
  conversationFindFirst.mockImplementation(async (args) => {
    const conversation = base.conversation
    if (conversation === null) return null
    if (args.include !== undefined && 'messages' in args.include) {
      return { ...conversation, messages: base.messages }
    }
    return conversation
  })

  messageCreate.mockImplementation(async (args) => ({
    id: MESSAGE_ID,
    conversationId: args.data.conversationId,
    senderId: args.data.senderId,
    contenu: args.data.contenu,
    createdAt: MESSAGE_DATE,
  }))
})

// ─── envoyerMessage — happy path + seau réel ─────────────────────────────────

describe('envoyerMessage — envoi valide', () => {
  it('écrit senderId = session.userId et le contenu NETTOYÉ, émet messageEnvoye une fois, consomme le seau APRÈS le create', async () => {
    const resultat = await envoyerMessage(PAYLOAD)

    // Contenu balisé → balises retirées (nettoyage VRAI du module contenu).
    expect(messageCreate).toHaveBeenCalledTimes(1)
    expect(messageCreate).toHaveBeenCalledWith({
      data: {
        conversationId: CONV_ID,
        senderId: USER_ID,
        contenu: 'Bonjour Awa',
      },
    })

    expect(messageEnvoye).toHaveBeenCalledTimes(1)
    expect(messageEnvoye).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      messageId: MESSAGE_ID,
      emetteurId: USER_ID,
    })

    // Le seau est payé UNIQUEMENT après l'écriture réelle, à la bonne clé.
    expect(recordAttempt).toHaveBeenCalledTimes(1)
    expect(recordAttempt).toHaveBeenCalledWith(CLE_SEAU, MESSAGERIE_ENVOI_WINDOW_MS)
    expect(vi.mocked(recordAttempt).mock.invocationCallOrder[0]).toBeGreaterThan(
      messageCreate.mock.invocationCallOrder[0] ?? 0,
    )

    expect(resultat).toEqual({
      ok: true,
      message: {
        id: MESSAGE_ID,
        contenu: 'Bonjour Awa',
        emetteurId: USER_ID,
        createdAt: MESSAGE_DATE.toISOString(),
      },
    })
  })

  it('seau réel : 10 envois passent, le 11e est refusé `debit` sans écrire en base', async () => {
    for (let i = 0; i < MESSAGERIE_MAX_ENVOIS_PAR_COMPTE; i++) {
      const passe = await envoyerMessage(PAYLOAD)
      expect(passe).toEqual({ ok: true, message: expect.any(Object) })
    }

    const refus = await envoyerMessage(PAYLOAD)

    expect(refus).toEqual({ ok: false, erreur: 'debit' })
    // 10 écritures seulement : le 11e n'atteint jamais la base.
    expect(messageCreate).toHaveBeenCalledTimes(MESSAGERIE_MAX_ENVOIS_PAR_COMPTE)
    expect(recordAttempt).toHaveBeenCalledTimes(MESSAGERIE_MAX_ENVOIS_PAR_COMPTE)
    expect(checkRateLimit).toHaveBeenCalledTimes(MESSAGERIE_MAX_ENVOIS_PAR_COMPTE + 1)
  })

  it("un recruteur participant envoie aussi (rôle admis = candidat OU recruteur)", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: AUTRE_USER_ID, role: 'recruteur' })

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat.ok).toBe(true)
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senderId: AUTRE_USER_ID }),
      }),
    )
  })
})

// ─── envoyerMessage — refus sans effet de bord ───────────────────────────────

describe('envoyerMessage — chaque refus précoce est sans écriture et sans seau', () => {
  it("lecture seule (statut `refusee`) : 'lecture-seule', zéro create, zéro seau", async () => {
    base.conversation = convOuverte('refusee')

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat).toEqual({ ok: false, erreur: 'lecture-seule' })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()
  })

  it("bloquée : 'bloquee', zéro create, zéro seau, et le where porte les DEUX sens du blocage", async () => {
    blocageFindFirst.mockImplementation(async () => ({ id: 77 }))

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat).toEqual({ ok: false, erreur: 'bloquee' })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(blocageFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { bloqueurId: USER_ID, bloqueId: AUTRE_USER_ID },
          { bloqueurId: AUTRE_USER_ID, bloqueId: USER_ID },
        ],
      },
      select: { id: true },
    })
  })

  it("non-participant (chargerConversation null) : 'inconnue' indiscernable, zéro create, zéro seau", async () => {
    base.conversation = null

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("contenu réduit à du blanc après nettoyage : 'inconnue', zéro create, zéro seau", async () => {
    const resultat = await envoyerMessage({ conversationId: CONV_ID, contenu: '   ' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(conversationFindFirst).not.toHaveBeenCalled()
  })

  it("payload `conversationId: 'x'` (forme hors schema) : 'inconnue', AUCUNE lecture", async () => {
    const resultat = await envoyerMessage({
      conversationId: 'x',
      contenu: 'ok',
    } as unknown as PayloadEnvoi)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it("rôle admin : 'inconnue' (panne générique), aucune lecture, aucun verdict différencié", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()
  })
})

// ─── envoyerMessage — échec DB : verdict générique, log sans PII ─────────────

describe('envoyerMessage — erreur DB inattendue', () => {
  it("create qui lève : 'inconnue', zéro recordAttempt, messageEnvoye jamais émis, log SANS donnée personnelle", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    messageCreate.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await envoyerMessage({ conversationId: CONV_ID, contenu: 'Secret 06 12 34 56 78' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()

    // Un SEUL log, dont l'objet ne contient QUE l'id et le code — jamais le
    // contenu du message, jamais le userId.
    expect(consoleError).toHaveBeenCalledTimes(1)
    const [marque, donnees] = consoleError.mock.calls[0] ?? []
    expect(marque).toBe('[messagerie] envoi')
    expect(donnees).toEqual({ conversationId: CONV_ID, code: 'INCONNU' })
    expect(Object.keys(donnees ?? {}).sort()).toEqual(['code', 'conversationId'])
    expect(JSON.stringify(donnees)).not.toContain('Secret')
    expect(JSON.stringify(donnees)).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })

  it('erreur Prisma connue : le code utile au diagnostic est loggé (toujours sans contenu)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    messageCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('write timeout', {
        code: 'P2002',
        clientVersion: '6.19.3',
      })
    })

    const resultat = await envoyerMessage(PAYLOAD)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[messagerie] envoi', {
      conversationId: CONV_ID,
      code: 'P2002',
    })

    consoleError.mockRestore()
  })
})

// ─── chargerMessagesAnciens ──────────────────────────────────────────────────

describe('chargerMessagesAnciens', () => {
  it('non-participant : null (404 globale, aucun verdict différencié)', async () => {
    base.conversation = null

    await expect(chargerMessagesAnciens(CONV_ID, MESSAGE_DATE.toISOString())).resolves.toBeNull()
  })

  it('conversationId invalide (fractionnaire, nul, négatif, hors Int32) : null, AUCUNE requête', async () => {
    await expect(chargerMessagesAnciens(1.5, MESSAGE_DATE.toISOString())).resolves.toBeNull()
    await expect(chargerMessagesAnciens(0, MESSAGE_DATE.toISOString())).resolves.toBeNull()
    await expect(chargerMessagesAnciens(-3, MESSAGE_DATE.toISOString())).resolves.toBeNull()
    // 2^31 : au-delà, Prisma lèverait hors de toute gestion — verdict nul
    // SANS requête plutôt qu'une erreur 500 propagée au fil.
    await expect(chargerMessagesAnciens(2_147_483_648, MESSAGE_DATE.toISOString())).resolves.toBeNull()

    expect(conversationFindFirst).not.toHaveBeenCalled()
  })

  it('curseur ISO invalide : null, AUCUNE requête (pas de Invalid Date dans le where)', async () => {
    await expect(chargerMessagesAnciens(CONV_ID, 'pas-une-date')).resolves.toBeNull()

    expect(conversationFindFirst).not.toHaveBeenCalled()
  })

  it('participant : mapping en MessageAffiche (dates en ISO) + aPlusAncien', async () => {
    // Prisma renvoie en orderBy createdAt DESC : la fixture reproduit cet
    // ordre, le DAL renverse en mémoire pour rendre l'ASC chronologique.
    const plusAncien = new Date('2026-02-01T08:00:00.000Z')
    base.messages = [
      { id: 2, contenu: 'Le plus récent', senderId: USER_ID, createdAt: MESSAGE_DATE },
      { id: 1, contenu: 'Le plus ancien', senderId: AUTRE_USER_ID, createdAt: plusAncien },
    ]

    const page = await chargerMessagesAnciens(CONV_ID, MESSAGE_DATE.toISOString())

    expect(page).toEqual({
      messages: [
        { id: 1, contenu: 'Le plus ancien', emetteurId: AUTRE_USER_ID, createdAt: plusAncien.toISOString() },
        { id: 2, contenu: 'Le plus récent', emetteurId: USER_ID, createdAt: MESSAGE_DATE.toISOString() },
      ],
      aPlusAncien: false,
    })
  })
})

// ─── marquerConversationLue ──────────────────────────────────────────────────

describe('marquerConversationLue', () => {
  it('avancerLecture true : messageLu émis avec les ids', async () => {
    await marquerConversationLue(CONV_ID)

    expect(messageLu).toHaveBeenCalledTimes(1)
    expect(messageLu).toHaveBeenCalledWith({ conversationId: CONV_ID, lecteurId: USER_ID })
  })

  it('avancerLecture false (déjà lu) : messageLu JAMAIS émis', async () => {
    // CAS du DAL à zéro + ligne d'état déjà présente → faux avancement.
    etatUpdateMany.mockImplementation(async () => ({ count: 0 }))
    etatFindUnique.mockImplementation(async () => ({ conversationId: CONV_ID }))

    await marquerConversationLue(CONV_ID)

    expect(messageLu).not.toHaveBeenCalled()
  })

  it('id invalide (nul, fractionnaire, hors Int32) : sortie silencieuse, aucune requête du DAL', async () => {
    await marquerConversationLue(0)
    await marquerConversationLue(2.5)
    await marquerConversationLue(2_147_483_648)

    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(messageLu).not.toHaveBeenCalled()
  })

  it("rôle admin : aucune écriture d'état (aucun verdict non plus)", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    await marquerConversationLue(CONV_ID)

    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(messageLu).not.toHaveBeenCalled()
  })

  it('non-participant : AUCUNE écriture d’état (garde participant avant avancerLecture)', async () => {
    // L'invariant « chaque écriture exige la participation » du DAL porte
    // sur l'APPELANT : sans `chargerConversation`, n'importe quel compte
    // créerait des lignes ConversationEtat sur une conversation d'autrui
    // (ids auto-incrément énumérables, ni seau ni borne).
    base.conversation = null

    await marquerConversationLue(CONV_ID)

    expect(conversationFindFirst).toHaveBeenCalledTimes(1)
    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(etatCreate).not.toHaveBeenCalled()
    expect(etatUpdateMany).not.toHaveBeenCalled()
    expect(messageLu).not.toHaveBeenCalled()
  })
})

// ─── masquerConversation ─────────────────────────────────────────────────────

describe('masquerConversation', () => {
  it('non-participant : AUCUN upsert (une écriture d’état par un étranger est interdite)', async () => {
    base.conversation = null

    await masquerConversation(CONV_ID)

    expect(etatUpsert).not.toHaveBeenCalled()
  })

  it('participant : upsert idempotent sur la clé composite (conversationId, userId)', async () => {
    await masquerConversation(CONV_ID)

    expect(etatUpsert).toHaveBeenCalledTimes(1)
    const args = etatUpsert.mock.calls[0]?.[0]
    expect(args?.where).toEqual({
      conversationId_userId: { conversationId: CONV_ID, userId: USER_ID },
    })
    expect(args?.create).toEqual({
      conversationId: CONV_ID,
      userId: USER_ID,
      masqueLe: expect.any(Date),
    })
    expect(args?.update).toEqual({ masqueLe: expect.any(Date) })
  })

  it('conversationId hors schema : sortie silencieuse, aucun upsert', async () => {
    await masquerConversation(0)
    await masquerConversation(-1)

    expect(etatUpsert).not.toHaveBeenCalled()
  })
})
