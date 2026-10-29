import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  chiffrerSecretTotp,
  genererCodeTotp,
  genererJeton,
  genererSecretTotp,
  hacherCodeRecuperation,
  hacherJeton,
  pasTotp,
} from './admin-crypto'
import {
  compterAdminsActifs,
  creerChallengeAdmin,
  verifierChallengeAdmin,
  verifierCodeAdminPourSession,
} from './admin-auth'

const mocks = vi.hoisted(() => {
  const tx = {
    adminAuthChallenge: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { updateMany: vi.fn() },
    adminRecoveryCode: { updateMany: vi.fn() },
  }
  return {
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    challengeFindUnique: vi.fn(),
    challengeUpdateMany: vi.fn(),
    challengeCreate: vi.fn(),
    recoveryFindFirst: vi.fn(),
    userFindUnique: vi.fn(),
    userUpdateMany: vi.fn(),
    userCount: vi.fn(),
    checkRateLimit: vi.fn(),
    recordAttempt: vi.fn(),
    resetAttempts: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminAuthChallenge: {
      findUnique: mocks.challengeFindUnique,
      updateMany: mocks.challengeUpdateMany,
      create: mocks.challengeCreate,
    },
    adminRecoveryCode: {
      findFirst: mocks.recoveryFindFirst,
    },
    user: {
      findUnique: mocks.userFindUnique,
      updateMany: mocks.userUpdateMany,
      count: mocks.userCount,
    },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  recordAttempt: mocks.recordAttempt,
  resetAttempts: mocks.resetAttempts,
}))

const CLE = Buffer.alloc(32, 11).toString('base64')
process.env.ADMIN_2FA_KEY = CLE
const SECRET = genererSecretTotp()
const SECRET_CHIFFRE = chiffrerSecretTotp(SECRET)

function challenge(overrides: Record<string, unknown> = {}) {
  const { user: userOverrides, ...reste } = overrides
  return {
    id: 'challenge-1',
    userId: 7,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    consumedAt: null,
    user: {
      id: 7,
      name: 'Ada Admin',
      email: 'ada@example.cm',
      role: 'admin',
      isActive: true,
      sessionVersion: 4,
      totpSecret: SECRET_CHIFFRE,
      totpEnabledAt: new Date(),
      totpLastStep: null,
      anonymizedAt: null,
      ...((userOverrides as object | undefined) ?? {}),
    },
    ...reste,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'))
  process.env.ADMIN_2FA_KEY = CLE
  vi.clearAllMocks()
  mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  mocks.challengeFindUnique.mockResolvedValue(challenge())
  mocks.challengeUpdateMany.mockResolvedValue({ count: 1 })
  mocks.challengeCreate.mockResolvedValue({})
  mocks.tx.adminAuthChallenge.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.adminAuthChallenge.create.mockResolvedValue({})
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 })
  mocks.tx.adminRecoveryCode.updateMany.mockResolvedValue({ count: 1 })
  mocks.recoveryFindFirst.mockResolvedValue(null)
  mocks.userUpdateMany.mockResolvedValue({ count: 1 })
  mocks.userCount.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('creerChallengeAdmin', () => {
  it('stocke uniquement le hash et invalide les challenges précédents', async () => {
    const { token, expiresAt } = await creerChallengeAdmin(7)

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(expiresAt.getTime()).toBe(Date.now() + 5 * 60 * 1000)
    expect(mocks.tx.adminAuthChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 7, consumedAt: null }),
      }),
    )
    const data = mocks.tx.adminAuthChallenge.create.mock.calls[0]?.[0].data
    expect(data.userId).toBe(7)
    expect(data.tokenHash).toBe(hacherJeton(token))
    expect(JSON.stringify(data)).not.toContain(token)
  })
})

describe('verifierChallengeAdmin', () => {
  it('accepte un TOTP valide et met à jour le pas anti-rejeu', async () => {
    const token = genererJeton()
    const code = genererCodeTotp(SECRET, pasTotp())
    const resultat = await verifierChallengeAdmin({ challengeToken: token, code })

    expect(resultat).toEqual({
      id: '7',
      name: 'Ada Admin',
      email: 'ada@example.cm',
      role: 'admin',
      sessionVersion: 4,
    })
    expect(mocks.tx.adminAuthChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'challenge-1',
          consumedAt: null,
        }),
        data: { consumedAt: new Date() },
      }),
    )
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        role: 'admin',
        isActive: true,
        totpLastStep: null,
      },
      data: { totpLastStep: pasTotp() },
    })
    expect(mocks.resetAttempts).toHaveBeenCalled()
  })

  it('refuse un code TOTP invalide et compte la tentative', async () => {
    const resultat = await verifierChallengeAdmin({
      challengeToken: genererJeton(),
      code: '000000',
    })
    expect(resultat).toBeNull()
    expect(mocks.recordAttempt).toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('refuse le rejeu du même pas TOTP', async () => {
    const dernierPas = pasTotp()
    mocks.challengeFindUnique.mockResolvedValue(
      challenge({ user: { totpLastStep: dernierPas } }),
    )
    const resultat = await verifierChallengeAdmin({
      challengeToken: genererJeton(),
      code: genererCodeTotp(SECRET, dernierPas),
    })
    expect(resultat).toBeNull()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('accepte un code de récupération et le consomme une seule fois', async () => {
    const code = 'ABCDE-FGHIJ'
    mocks.recoveryFindFirst.mockResolvedValue({ id: 12 })
    const resultat = await verifierChallengeAdmin({
      challengeToken: genererJeton(),
      code,
    })
    expect(resultat?.id).toBe('7')
    expect(mocks.recoveryFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 7,
        codeHash: hacherCodeRecuperation(code),
        usedAt: null,
      },
      select: { id: true },
    })
    expect(mocks.tx.adminRecoveryCode.updateMany).toHaveBeenCalledWith({
      where: { id: 12, usedAt: null },
      data: { usedAt: new Date() },
    })
  })

  it('refuse un challenge expiré, consommé, ou un utilisateur non-admin', async () => {
    mocks.challengeFindUnique.mockResolvedValue(
      challenge({ expiresAt: new Date(Date.now() - 1) }),
    )
    expect(
      await verifierChallengeAdmin({
        challengeToken: genererJeton(),
        code: genererCodeTotp(SECRET, pasTotp()),
      }),
    ).toBeNull()

    mocks.challengeFindUnique.mockResolvedValue(
      challenge({ consumedAt: new Date(Date.now() - 1) }),
    )
    expect(
      await verifierChallengeAdmin({
        challengeToken: genererJeton(),
        code: genererCodeTotp(SECRET, pasTotp()),
      }),
    ).toBeNull()

    mocks.challengeFindUnique.mockResolvedValue(
      challenge({ user: { role: 'candidat' } }),
    )
    expect(
      await verifierChallengeAdmin({
        challengeToken: genererJeton(),
        code: genererCodeTotp(SECRET, pasTotp()),
      }),
    ).toBeNull()
  })

  it('refuse quand le rate limit du challenge est dépassé', async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 1000 })
    const resultat = await verifierChallengeAdmin({
      challengeToken: genererJeton(),
      code: genererCodeTotp(SECRET, pasTotp()),
    })
    expect(resultat).toBeNull()
    expect(mocks.recordAttempt).not.toHaveBeenCalled()
  })

  it('refuse des identifiants absents ou vides', async () => {
    expect(await verifierChallengeAdmin({})).toBeNull()
    expect(
      await verifierChallengeAdmin({ challengeToken: 'x', code: '' }),
    ).toBeNull()
  })
})

describe('verifierCodeAdminPourSession', () => {
  it('accepte un TOTP et met à jour le pas anti-rejeu', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 7,
      role: 'admin',
      isActive: true,
      totpSecret: SECRET_CHIFFRE,
      totpEnabledAt: new Date(),
      totpLastStep: null,
      anonymizedAt: null,
    })
    const code = genererCodeTotp(SECRET, pasTotp())
    expect(await verifierCodeAdminPourSession(7, code)).toBe(true)
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 7, role: 'admin', isActive: true, totpLastStep: null },
      data: { totpLastStep: pasTotp() },
    })
  })

  it('refuse un compte non-admin, inactif ou un code de récupération inconnu', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 7,
      role: 'candidat',
      isActive: true,
      totpSecret: SECRET_CHIFFRE,
      totpEnabledAt: new Date(),
      totpLastStep: null,
      anonymizedAt: null,
    })
    expect(await verifierCodeAdminPourSession(7, '123456')).toBe(false)

    mocks.userFindUnique.mockResolvedValue({
      id: 7,
      role: 'admin',
      isActive: true,
      totpSecret: SECRET_CHIFFRE,
      totpEnabledAt: new Date(),
      totpLastStep: null,
      anonymizedAt: null,
    })
    mocks.recoveryFindFirst.mockResolvedValue(null)
    expect(await verifierCodeAdminPourSession(7, 'ABCDE-FGHIJ')).toBe(false)
  })
})

describe('compterAdminsActifs', () => {
  it('compte uniquement les admins actifs, activés et non anonymisés', async () => {
    mocks.userCount.mockResolvedValue(2)
    expect(await compterAdminsActifs()).toBe(2)
    expect(mocks.userCount).toHaveBeenCalledWith({
      where: {
        role: 'admin',
        isActive: true,
        totpEnabledAt: { not: null },
        anonymizedAt: null,
      },
    })
  })
})
