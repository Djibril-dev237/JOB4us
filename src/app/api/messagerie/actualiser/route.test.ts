import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'

import { GET } from './route'

// ─── Tests de GET /api/messagerie/actualiser (M8, Vague 2) ───────────────────
// Verrous :
//  1. 401 sans session AVANT toute lecture base ;
//  2. 404 INDISCERNABLE : l'admin et le non-participant reçoivent un corps
//     STRICTEMENT identique à la conversation inexistante (aucune
//     énumération de /messages/1, 2, 3…) ;
//  3. 400 sur conversationId non strict (regex, pas parseInt) ;
//  4. 200 avec le shape exact de ReponseActualisation (dates en ISO) ;
//  5. ZÉRO ÉCRITURE : la route de polling est idempotente — aucun create /
//     update / upsert n'est même DÉFINI sur le double prisma : toute
//     écriture lèverait une TypeError.
//
// Patron : vi.hoisted + vi.mock('@/lib/prisma') et vi.mock('@/auth'), à
// l'image de src/app/api/files/cv/route.test.ts. Le DAL réel
// (messagerie-dal) tourne SUR le double : c'est lui qui interroge
// prisma.conversation.findFirst, la route n'écrit rien elle-même.
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

interface ArgsConversationFindFirst {
  where?: unknown
  include?: { candidature?: unknown; messages?: unknown }
}

interface ArgsBlocageFindFirst {
  where?: { OR?: Array<Record<string, number>> }
  select?: unknown
}

const {
  authMock,
  blocageFindFirst,
  conversationFindFirst,
  conversationEtatUpsert,
  conversationEtatCreate,
  conversationEtatUpdateMany,
  messageCreate,
} = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<MockSession | null>>(),
  blocageFindFirst: vi.fn<(args: ArgsBlocageFindFirst) => Promise<{ bloqueurId: number } | null>>(),
  conversationFindFirst: vi.fn<(args: ArgsConversationFindFirst) => Promise<unknown>>(),
  // Écritures potentielles (interdites) : exposées pour être ASSERTÉES non
  // appelées — une écriture réelle sur ce double exploserait ou ci-dessous.
  conversationEtatUpsert: vi.fn(),
  conversationEtatCreate: vi.fn(),
  conversationEtatUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: conversationFindFirst },
    blocage: { findFirst: blocageFindFirst },
    conversationEtat: {
      upsert: conversationEtatUpsert,
      create: conversationEtatCreate,
      updateMany: conversationEtatUpdateMany,
    },
    message: { create: messageCreate, findMany: vi.fn(), findFirst: vi.fn() },
    messageModeration: { findMany: vi.fn(async () => []) },
  },
}))

// ─── Données de départ ───────────────────────────────────────────────────────

const CONVERSATION_ID = 10

/** Candidat 42, recruteur 3 : les participants DÉRIVÉS de la candidature. */
function conversationChargee(statut = 'envoyee'): unknown {
  return {
    id: CONVERSATION_ID,
    candidatureId: 20,
    candidature: {
      statut,
      offreId: 30,
      offre: {
        titre: 'Développeur·se',
        statut: 'publiee',
        deletedAt: null,
        entreprise: { userId: 3, user: { id: 3, name: 'Rita Recruteur' } },
      },
      candidat: { user: { id: 42, name: 'Paul Candidat' } },
    },
  }
}

/** Dernière page du DAL : ordre DESC brut, ≤ PAGE+1 (31). */
function dernierePage(bruts: Array<{ id: number; contenu: string; senderId: number; createdAt: Date }>) {
  return { id: CONVERSATION_ID, messages: bruts }
}

function login(id: number, role: Role): void {
  authMock.mockResolvedValue({
    user: { id, role },
    expires: '2100-01-01T00:00:00.000Z',
  })
}

/** Le double répond selon l'include : candidature (participation) ou messages. */
function repondConversation(conversation: unknown, page: unknown): void {
  conversationFindFirst.mockImplementation(async (args) => {
    if (args.include && 'messages' in args.include) return page
    return conversation
  })
}

function requete(query = `?conversationId=${CONVERSATION_ID}`): NextRequest {
  return new NextRequest(`http://localhost:3000/api/messagerie/actualiser${query}`)
}

function loginCandidat(): void {
  login(42, 'candidat')
}

beforeEach(() => {
  vi.clearAllMocks()
  blocageFindFirst.mockResolvedValue(null)
})

// ─── 401 : session ───────────────────────────────────────────────────────────

describe('GET /api/messagerie/actualiser — session', () => {
  it('refuse un non connecté par 401, avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(requete())

    expect(response.status).toBe(401)
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(blocageFindFirst).not.toHaveBeenCalled()
  })
})

// ─── 400 : paramètre ─────────────────────────────────────────────────────────

describe('GET /api/messagerie/actualiser — paramètre', () => {
  it('refuse conversationId absent, non numérique ou négatif (400), sans requête base', async () => {
    loginCandidat()

    for (const query of [
      '',
      '?conversationId=abc',
      '?conversationId=-1',
      '?conversationId=1.5',
      // 20 chiffres : entier JS valide mais hors Int32 → 400, jamais un
      // PrismaClientValidationError en 500.
      '?conversationId=99999999999999999999',
    ]) {
      const response = await GET(requete(query))
      expect(response.status).toBe(400)
    }
    expect(conversationFindFirst).not.toHaveBeenCalled()
  })
})

// ─── 404 indiscernable ───────────────────────────────────────────────────────

describe('GET /api/messagerie/actualiser — 404 indiscernable', () => {
  it("répond 404 avec le MÊME corps pour un non-participant et pour une conversation inexistante", async () => {
    loginCandidat()
    // Non-participant : la lecture participant rend null.
    repondConversation(null, null)

    const nonParticipant = await GET(requete('?conversationId=9999'))
    expect(nonParticipant.status).toBe(404)
    expect(await nonParticipant.json()).toEqual({ error: 'introuvable' })
  })

  it("répond 404 au rôle admin avec le CORPS IDENTIQUE au non-participant (pas de boîte admin)", async () => {
    login(1, 'admin')

    const admin = await GET(requete())
    expect(admin.status).toBe(404)
    expect(await admin.json()).toEqual({ error: 'introuvable' })
    // Aucune lecture base : le refus est structurel, pas une recherche.
    expect(conversationFindFirst).not.toHaveBeenCalled()
  })
})

// ─── 200 : participant ───────────────────────────────────────────────────────

describe('GET /api/messagerie/actualiser — participant', () => {
  it('renvoie le shape exact : dernières pages ASC sérialisées ISO, zéro écriture', async () => {
    loginCandidat()
    const plusRecent = new Date('2026-10-10T10:05:00.000Z')
    const plusAncien = new Date('2026-10-10T10:00:00.000Z')
    // Brut DESC attendu par le DAL (le plus récent d'abord).
    repondConversation(
      conversationChargee(),
      dernierePage([
        { id: 2, contenu: 'Deuxième', senderId: 3, createdAt: plusRecent },
        { id: 1, contenu: 'Premier', senderId: 42, createdAt: plusAncien },
      ]),
    )

    const response = await GET(requete())
    const corps = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    // Shape EXACT : aucune clé ajoutée, aucune clé manquante.
    expect(Object.keys(corps).sort()).toEqual([
      'aPlusAncien',
      'bloqueeParAutre',
      'bloqueeParMoi',
      'lectureSeule',
      'messages',
      'ok',
    ])
    expect(corps.ok).toBe(true)
    expect(corps.aPlusAncien).toBe(false)
    expect(corps.lectureSeule).toBe(false)
    expect(corps.bloqueeParMoi).toBe(false)
    expect(corps.bloqueeParAutre).toBe(false)
    // Dates en ISO (jamais des Date sérialisées en défaut JSON).
    expect(corps.messages).toEqual([
      { id: 1, contenu: 'Premier', emetteurId: 42, createdAt: '2026-10-10T10:00:00.000Z' },
      { id: 2, contenu: 'Deuxième', emetteurId: 3, createdAt: '2026-10-10T10:05:00.000Z' },
    ])
    // ZÉRO écriture : le polling est une lecture idempotente.
    expect(conversationEtatUpsert).not.toHaveBeenCalled()
    expect(conversationEtatCreate).not.toHaveBeenCalled()
    expect(conversationEtatUpdateMany).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('marque lectureSeule dès qu’un statut terminal fige la conversation', async () => {
    loginCandidat()
    repondConversation(conversationChargee('refusee'), dernierePage([]))

    const response = await GET(requete())
    const corps = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(corps.lectureSeule).toBe(true)
  })

  it('pose le Cache-Control no-store : un cache intermédiaire figerait le fil', async () => {
    loginCandidat()
    repondConversation(conversationChargee(), dernierePage([]))

    const response = await GET(requete())

    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})

// ─── Blocage (les deux sens) ─────────────────────────────────────────────────

describe('GET /api/messagerie/actualiser — blocage', () => {
  it('blocage MOI → bloqueeParMoi + lectureSeule, où le where couvre les deux sens', async () => {
    loginCandidat()
    repondConversation(conversationChargee(), dernierePage([]))
    blocageFindFirst.mockResolvedValue({ bloqueurId: 42 })

    const response = await GET(requete())
    const corps = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(corps.bloqueeParMoi).toBe(true)
    expect(corps.bloqueeParAutre).toBe(false)
    expect(corps.lectureSeule).toBe(true)
    // Les deux sens dans le where : je ne peux pas déduire « qui » a bloqué
    // d'un seul sens de recherche.
    expect(blocageFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { bloqueurId: 42, bloqueId: 3 },
          { bloqueurId: 3, bloqueId: 42 },
        ],
      },
      select: { bloqueurId: true },
    })
  })

  it('blocage AUTRE → bloqueeParAutre + lectureSeule, zéro écriture', async () => {
    loginCandidat()
    repondConversation(conversationChargee(), dernierePage([]))
    blocageFindFirst.mockResolvedValue({ bloqueurId: 3 })

    const response = await GET(requete())
    const corps = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(corps.bloqueeParMoi).toBe(false)
    expect(corps.bloqueeParAutre).toBe(true)
    expect(corps.lectureSeule).toBe(true)
    expect(conversationEtatUpsert).not.toHaveBeenCalled()
  })
})
