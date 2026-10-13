import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { creerConversationDepuisCandidature } from './messagerie-creation'

// ─── Tests de la création de conversation (M8, Vague 2) ──────────────────────
// Trois critères verrouillés ici :
// 1. candidature ABSENTE → `null` et ZÉRO écriture (aucune conversation
//    orpheline, aucun create tenté) ;
// 2. create → l'id retourné, en liste blanche `{ candidatureId }` seulement ;
// 3. COURSE (P2002 sur l'unicité candidatureId) → relecture de la ligne
//    gagnante et id rendu — idempotent, jamais une seconde conversation ;
//    toute AUTRE erreur remonte (ce lib n'est pas dans une action).
//
// Patron repris de messagerie-dal.test.ts : vi.hoisted + vi.mock('@/lib/prisma')
// n'exposant QUE candidature.findUnique et conversation.{create,findUnique} —
// toute requête imprévue lèverait une TypeError et casserait le test.
// ---------------------------------------------------------------------------

// ─── Types des doubles (aucun `any`) ─────────────────────────────────────────

interface ArgsCandidatureFindUnique {
  where: { id: number }
  select?: unknown
}

interface ArgsConversationCreate {
  data: { candidatureId: number }
  select?: unknown
}

interface ArgsConversationFindUnique {
  where: { candidatureId: number }
  select?: unknown
}

const { candidatureFindUnique, conversationCreate, conversationFindUnique } = vi.hoisted(() => ({
  candidatureFindUnique: vi.fn<(args: ArgsCandidatureFindUnique) => Promise<unknown>>(),
  conversationCreate: vi.fn<(args: ArgsConversationCreate) => Promise<unknown>>(),
  conversationFindUnique: vi.fn<(args: ArgsConversationFindUnique) => Promise<unknown>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidature: { findUnique: candidatureFindUnique },
    conversation: { create: conversationCreate, findUnique: conversationFindUnique },
  },
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CANDIDATURE_ID = 9
const CONV_ID = 55

/** Erreur P2002 « course sur l'unicité candidatureId » (client réel Prisma). */
function erreurP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`candidature_id`)',
    { code: 'P2002', clientVersion: '6.19.3' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()

  candidatureFindUnique.mockImplementation(async () => ({ id: CANDIDATURE_ID }))
  conversationCreate.mockImplementation(async () => ({ id: CONV_ID }))
  conversationFindUnique.mockImplementation(async () => null)
})

// ─── Candidature absente ─────────────────────────────────────────────────────

describe('candidature inexistante', () => {
  it('rend null et ne JAMAIS crée de conversation', async () => {
    candidatureFindUnique.mockImplementation(async () => null)

    await expect(creerConversationDepuisCandidature(CANDIDATURE_ID)).resolves.toBeNull()

    expect(conversationCreate).not.toHaveBeenCalled()
    expect(conversationFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: CANDIDATURE_ID },
      select: { id: true },
    })
  })
})

// ─── Création nominale ───────────────────────────────────────────────────────

describe('création nominale', () => {
  it("crée avec la liste blanche `{ candidatureId }` et rend l'id", async () => {
    await expect(creerConversationDepuisCandidature(CANDIDATURE_ID)).resolves.toBe(CONV_ID)

    expect(conversationCreate).toHaveBeenCalledTimes(1)
    expect(conversationCreate).toHaveBeenCalledWith({
      data: { candidatureId: CANDIDATURE_ID },
      select: { id: true },
    })
    // Aucune relecture inutile quand la création passe du premier coup.
    expect(conversationFindUnique).not.toHaveBeenCalled()
  })
})

// ─── Course concurrente ──────────────────────────────────────────────────────

describe('course sur l’unicité (P2002)', () => {
  it('relit la ligne gagnante et rend SON id — idempotent, jamais une 2e conversation', async () => {
    conversationCreate.mockImplementation(async () => {
      throw erreurP2002()
    })
    conversationFindUnique.mockImplementation(async () => ({ id: CONV_ID }))

    await expect(creerConversationDepuisCandidature(CANDIDATURE_ID)).resolves.toBe(CONV_ID)

    expect(conversationCreate).toHaveBeenCalledTimes(1)
    // La relecture pointe sur la clé d'unicité, pas sur une primaire inventée.
    expect(conversationFindUnique).toHaveBeenCalledWith({
      where: { candidatureId: CANDIDATURE_ID },
      select: { id: true },
    })
  })

  it("toute autre erreur (non P2002) remonte : ce lib n'est pas dans une action", async () => {
    conversationCreate.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('write timeout', {
        code: 'P2003',
        clientVersion: '6.19.3',
      })
    })

    await expect(creerConversationDepuisCandidature(CANDIDATURE_ID)).rejects.toThrow(
      'write timeout',
    )
    expect(conversationFindUnique).not.toHaveBeenCalled()
  })

  it('erreur non-Prisma (réseau…) : remonte telle quelle, jamais convertie en verdict', async () => {
    conversationCreate.mockImplementation(async () => {
      throw new Error('CONN_RESET')
    })

    await expect(creerConversationDepuisCandidature(CANDIDATURE_ID)).rejects.toThrow('CONN_RESET')
    expect(conversationFindUnique).not.toHaveBeenCalled()
  })
})
