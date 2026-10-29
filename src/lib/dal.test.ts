import { beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAdmin, verifySession } from './dal'

// ─── Garde admin autoritaire (M10) ──────────────────────────────────────────
//
// `requireAdmin` ne fait jamais confiance au JWT : la base doit confirmer le
// rôle, l'activité, l'absence d'anonymisation, le TOTP activé et la version de
// session. Tout échec est un 404 strict (jamais une redirection qui
// confirmerait l'existence de l'espace).

const { authMock, findUniqueMock, notFoundMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: findUniqueMock } },
}))
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

const SESSION_ADMIN = {
  user: { id: 7, role: 'admin', sessionVersion: 3 },
}

const ADMIN_VALIDE = {
  role: 'admin',
  isActive: true,
  sessionVersion: 3,
  anonymizedAt: null,
  totpEnabledAt: new Date(),
}

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(SESSION_ADMIN)
    findUniqueMock.mockResolvedValue(ADMIN_VALIDE)
  })

  it('retourne la session quand la base confirme tout', async () => {
    await expect(requireAdmin()).resolves.toEqual({
      userId: 7,
      role: 'admin',
      sessionVersion: 3,
    })
  })

  it('répond 404 pour un visiteur', async () => {
    authMock.mockResolvedValue(null)
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('répond 404 pour un candidat ou un recruteur', async () => {
    authMock.mockResolvedValue({ user: { id: 7, role: 'candidat', sessionVersion: 0 } })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('répond 404 pour un admin suspendu', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, isActive: false })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('répond 404 pour un admin anonymisé', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, anonymizedAt: new Date() })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('répond 404 pour un admin sans TOTP activé', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, totpEnabledAt: null })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('répond 404 quand la version de session ne correspond plus', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, sessionVersion: 4 })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('répond 404 quand le rôle en base a changé', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, role: 'recruteur' })
    await expect(requireAdmin()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('verifySession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(SESSION_ADMIN)
    findUniqueMock.mockResolvedValue(ADMIN_VALIDE)
  })

  it('redirige vers /login quand la session est absente', async () => {
    authMock.mockResolvedValue(null)
    await expect(verifySession()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })

  it('redirige vers /login quand la session a été révoquée en base', async () => {
    findUniqueMock.mockResolvedValue({ ...ADMIN_VALIDE, sessionVersion: 99 })
    await expect(verifySession()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/login')
  })
})
