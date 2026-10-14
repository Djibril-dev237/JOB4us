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

import {
  bloquerUtilisateur,
  chargerMessagesAnciens,
  debloquerUtilisateur,
  envoyerMessage,
  marquerConversationLue,
  masquerConversation,
  signalerMessage,
} from './messagerie'

// ─── Tests des actions serveur MESSAGERIE (M8, Vague 2 → Vague 3) ────────────
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
// VAGUE 3 (mêmes critères, appliqués à la modération) : le signalement ne
// consomme AUCUN seau et n'émet AUCUN hook M9 ; le blocage refuse
// l'auto-blocage sans écrire ; les trois refus d'`ecrireSignalement`
// (étranger / propre / non-participant) partagent le MÊME corps `inconnue`
// — aucun verdict différencié, aucun oracle.
//
// Patron repris de candidatures.securite.test.ts : prisma/dal mockés, hooks
// d'événements spyés (no-op réel), Zod et nettoyage tournant POUR DE VRAI.
// DIFFÉRENCE assumée : le SEAU EST RÉEL (en mémoire) — seuls
// `checkRateLimit`/`recordAttempt` sont spyés « call-through », pour prouver
// à la fois le comportement (10 envois puis refus) et l'absence de
// consommation sur un refus. Le DAL messagerie tourne aussi pour de vrai au
// dessus du prisma simulé (chargerConversation, avancerLecture, poserMasque,
// poserBlocage, leverBlocage, ecrireSignalement).
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

interface ArgsBlocageCreate {
  data: NsPrisma.BlocageUncheckedCreateInput
}

interface ArgsBlocageDeleteMany {
  where?: NsPrisma.BlocageWhereInput
}

interface ArgsSignalementCreate {
  data: NsPrisma.SignalementUncheckedCreateInput
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
  blocageCreate,
  blocageDeleteMany,
  signalementCreate,
} = vi.hoisted(() => ({
  conversationFindFirst: vi.fn<(args: ArgsConversationFindFirst) => Promise<unknown>>(),
  messageCreate: vi.fn<(args: ArgsMessageCreate) => Promise<MessageSim>>(),
  messageFindFirst: vi.fn<(args: ArgsMessageFindFirst) => Promise<unknown>>(),
  etatUpdateMany: vi.fn<(args: ArgsEtatUpdateMany) => Promise<{ count: number }>>(),
  etatFindUnique: vi.fn<(args: ArgsEtatFindUnique) => Promise<unknown>>(),
  etatCreate: vi.fn<(args: ArgsEtatCreate) => Promise<unknown>>(),
  etatUpsert: vi.fn<(args: ArgsEtatUpsert) => Promise<unknown>>(),
  blocageFindFirst: vi.fn<(args: ArgsBlocageFindFirst) => Promise<unknown>>(),
  blocageCreate: vi.fn<(args: ArgsBlocageCreate) => Promise<unknown>>(),
  blocageDeleteMany: vi.fn<(args: ArgsBlocageDeleteMany) => Promise<{ count: number }>>(),
  signalementCreate: vi.fn<(args: ArgsSignalementCreate) => Promise<unknown>>(),
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
    blocage: { findFirst: blocageFindFirst, create: blocageCreate, deleteMany: blocageDeleteMany },
    signalement: { create: signalementCreate },
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
  blocageCreate.mockImplementation(async () => ({ id: 1 }))
  blocageDeleteMany.mockImplementation(async () => ({ count: 1 }))
  signalementCreate.mockImplementation(async () => ({ id: 1 }))
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

// ─── signalerMessage — Vague 3 ───────────────────────────────────────────────

describe('signalerMessage — signalement valide', () => {
  it('create avec motif NETTOYÉ et auteurId = la session → { ok: true, deja: false }', async () => {
    // Le message existe et n'est pas le mien : la double lecture du DAL est
    // satisfaite (participation via chargerConversation n'est PAS requise ici,
    // c'est `ecrireSignalement` qui la porte dans SON where).
    messageFindFirst.mockImplementation(async () => ({ id: MESSAGE_ID }))

    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: '<b>Spam</b> répété' })

    // Le motif balisé est nettoyé PAR LE VRAI pipeline contenu.
    expect(signalementCreate).toHaveBeenCalledTimes(1)
    expect(signalementCreate.mock.calls[0]?.[0].data).toEqual({
      messageId: MESSAGE_ID,
      auteurId: USER_ID,
      motif: 'Spam répété',
    })
    // L'identité du signalant sort de la SESSION, jamais du payload.
    expect(resultat).toEqual({ ok: true, deja: false })

    // Le `where` de l'unique lecture porte participation + « pas mes
    // propres messages » (contrôles portés par la base, pas re-vérifiés).
    expect(messageFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: MESSAGE_ID,
      senderId: { not: USER_ID },
      conversation: {
        candidature: { OR: [{ candidat: { userId: USER_ID } }, { offre: { entreprise: { userId: USER_ID } } }] },
      },
    })
  })

  it('déjà signalé (P2002 absorbé par le DAL) → { ok: true, deja: true }, AUCUN create supplémentaire', async () => {
    messageFindFirst.mockImplementation(async () => ({ id: MESSAGE_ID }))
    signalementCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`message_id`,`auteur_id`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      )
    })

    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: 'Motif déjà utilisé' })

    expect(resultat).toEqual({ ok: true, deja: true })
    // Un seul create : le doublon est absorbé, jamais réécrit.
    expect(signalementCreate).toHaveBeenCalledTimes(1)
  })

  it('le signalement reste possible MÊME bloqué : AUCUNE lecture ni écriture de blocage', async () => {
    // Soupape de modération : si le blocage couvrait le signalement, un
    // harceleur pourrait s'auto-protéger en bloquant sa victime.
    messageFindFirst.mockImplementation(async () => ({ id: MESSAGE_ID }))
    blocageFindFirst.mockImplementation(async () => ({ id: 77 }))

    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: 'Harcèlement persistant' })

    expect(resultat).toEqual({ ok: true, deja: false })
    expect(blocageFindFirst).not.toHaveBeenCalled()
    expect(blocageCreate).not.toHaveBeenCalled()
  })

  it('ni seau ni hook M9 : checkRateLimit/recordAttempt/messageEnvoye/messageLu JAMAIS appelés', async () => {
    messageFindFirst.mockImplementation(async () => ({ id: MESSAGE_ID }))

    await signalerMessage({ messageId: MESSAGE_ID, motif: 'Motif légitime' })

    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()
    expect(messageLu).not.toHaveBeenCalled()
  })
})

describe('signalerMessage — refus sans effet de bord', () => {
  it("ecrireSignalement → null : 'inconnue' indiscernable, zéro create", async () => {
    // Un SEUL refus est observable côté action : la panne générique. Les
    // trois causes réelles (message étranger, message propre,
    // non-participation) ne sont distinguables QUE par le `where` du DAL,
    // clauses épinglées au mot dans messagerie-dal.test.ts — ici on
    // verrouille le contrat : quel que soit le motif du null, même corps,
    // aucune écriture, aucun oracle.
    messageFindFirst.mockImplementation(async () => null)

    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: 'Motif valable' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(signalementCreate).not.toHaveBeenCalled()
    // Le refus vient du `where` (une lecture a bien eu lieu), pas d'un
    // court-circuit de l'action.
    expect(messageFindFirst).toHaveBeenCalledTimes(1)
  })

  it("rôle admin : 'inconnue', AUCUNE lecture (panne générique)", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: 'Motif valable' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(signalementCreate).not.toHaveBeenCalled()
  })

  it("motif de 2 caractères (hors schema) : 'inconnue', zéro lecture", async () => {
    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: 'ab' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(signalementCreate).not.toHaveBeenCalled()
  })

  it("payload `messageId: 'x'` (forme hors schema) : 'inconnue', zéro lecture", async () => {
    const resultat = await signalerMessage({
      messageId: 'x',
      motif: 'Motif valable',
    } as unknown as { messageId: number; motif: string })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(signalementCreate).not.toHaveBeenCalled()
  })

  it("motif réduit à du blanc après nettoyage : 'inconnue', zéro lecture, zéro écriture", async () => {
    // Le schema accepte le brut (6 caractères de balises), le NETTOYAGE
    // refuse ensuite — même ordre que `envoyerMessage`.
    const resultat = await signalerMessage({ messageId: MESSAGE_ID, motif: '<b></b>' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageFindFirst).not.toHaveBeenCalled()
    expect(signalementCreate).not.toHaveBeenCalled()
  })

  it("create qui lève : 'inconnue', zéro seau, zéro hook, log SANS donnée personnelle", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    messageFindFirst.mockImplementation(async () => ({ id: MESSAGE_ID }))
    signalementCreate.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await signalerMessage({
      messageId: MESSAGE_ID,
      motif: 'Secret 06 12 34 56 78',
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()

    // Un SEUL log : id du message (pointeur) + code — JAMAIS le motif,
    // jamais le userId du signalant.
    expect(consoleError).toHaveBeenCalledTimes(1)
    const [marque, donnees] = consoleError.mock.calls[0] ?? []
    expect(marque).toBe('[messagerie] signalement')
    expect(donnees).toEqual({ messageId: MESSAGE_ID, code: 'INCONNU' })
    expect(Object.keys(donnees ?? {}).sort()).toEqual(['code', 'messageId'])
    expect(JSON.stringify(donnees)).not.toContain('Secret')
    expect(JSON.stringify(donnees)).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })
})

// ─── bloquerUtilisateur / debloquerUtilisateur — Vague 3 ─────────────────────

describe('bloquerUtilisateur', () => {
  it('create appelé avec la BONNE PAIRE (bloqueur = session, bloque = cible) → { ok: true }', async () => {
    const resultat = await bloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: true })
    expect(blocageCreate).toHaveBeenCalledTimes(1)
    expect(blocageCreate.mock.calls[0]?.[0].data).toEqual({
      bloqueurId: USER_ID,
      bloqueId: AUTRE_USER_ID,
    })
    // Portée globale : AUCUNE lecture de conversation nécessaire.
    expect(conversationFindFirst).not.toHaveBeenCalled()
  })

  it('paire déjà bloquée (P2002 absorbé par le DAL) → { ok: true } : jamais d’erreur au double clic', async () => {
    blocageCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`bloqueur_id`,`bloque_id`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      )
    })

    await expect(bloquerUtilisateur(AUTRE_USER_ID)).resolves.toEqual({ ok: true })
  })

  it("auto-blocage (cible = moi) : 'inconnue', ZÉRO écriture", async () => {
    const resultat = await bloquerUtilisateur(USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(blocageCreate).not.toHaveBeenCalled()
    expect(blocageDeleteMany).not.toHaveBeenCalled()
    expect(conversationFindFirst).not.toHaveBeenCalled()
  })

  it("cible hors schema (0, négatif, hors Int32) : 'inconnue', zéro écriture", async () => {
    await expect(bloquerUtilisateur(0)).resolves.toEqual({ ok: false, erreur: 'inconnue' })
    await expect(bloquerUtilisateur(-1)).resolves.toEqual({ ok: false, erreur: 'inconnue' })
    await expect(bloquerUtilisateur(2_147_483_648)).resolves.toEqual({ ok: false, erreur: 'inconnue' })

    expect(blocageCreate).not.toHaveBeenCalled()
  })

  it("rôle admin : 'inconnue', zéro écriture (panne générique)", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    const resultat = await bloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(blocageCreate).not.toHaveBeenCalled()
  })

  it("DAL qui lève : 'inconnue', log SANS donnée personnelle", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    blocageCreate.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await bloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledTimes(1)
    const [marque, donnees] = consoleError.mock.calls[0] ?? []
    expect(marque).toBe('[messagerie] blocage')
    expect(donnees).toEqual({ cibleUserId: AUTRE_USER_ID, code: 'INCONNU' })
    // Le code est loggé, l'IDENTITÉ de la session jamais.
    expect(JSON.stringify(donnees)).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })

  it('ni seau ni hook M9 sur le blocage', async () => {
    await bloquerUtilisateur(AUTRE_USER_ID)

    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(messageEnvoye).not.toHaveBeenCalled()
    expect(messageLu).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })
})

describe('debloquerUtilisateur', () => {
  it('deleteMany appelé sur la BONNE PAIRE ; 0 ligne supprimée → { ok: true } quand même', async () => {
    // 0 ligne = « déjà débloqué » : le verdict doit être IDENTIQUE à un
    // déblocage réel (idempotence visible par l'utilisateur).
    blocageDeleteMany.mockImplementation(async () => ({ count: 0 }))

    const resultat = await debloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: true })
    expect(blocageDeleteMany).toHaveBeenCalledTimes(1)
    expect(blocageDeleteMany.mock.calls[0]?.[0].where).toEqual({
      bloqueurId: USER_ID,
      bloqueId: AUTRE_USER_ID,
    })
    // Léver ne crée JAMAIS : aucune écriture de plus.
    expect(blocageCreate).not.toHaveBeenCalled()
  })

  it("auto-déblocage (cible = moi) : 'inconnue', ZÉRO écriture", async () => {
    const resultat = await debloquerUtilisateur(USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(blocageDeleteMany).not.toHaveBeenCalled()
  })

  it("deleteMany qui lève : 'inconnue', log sans donnée personnelle", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    blocageDeleteMany.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await debloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[messagerie] deblocage', {
      cibleUserId: AUTRE_USER_ID,
      code: 'INCONNU',
    })

    consoleError.mockRestore()
  })

  it("rôle admin : 'inconnue', zéro écriture", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    const resultat = await debloquerUtilisateur(AUTRE_USER_ID)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(blocageDeleteMany).not.toHaveBeenCalled()
  })
})
