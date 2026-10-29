import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/admin-crypto'

import {
  appliquerClaimsJwt,
  autoriserChallengeAdmin,
  autoriserIdentifiants,
} from './auth'

// ─── Providers Auth.js (M10) ────────────────────────────────────────────────
//
// Deux verrous sont testés ici, hors navigation :
//  1. le provider credentials ordinaire refuse TOUJOURS un admin, même avec
//     le bon mot de passe — sinon un POST direct contournerait le TOTP ;
//  2. le JWT fige sessionVersion et plafonne la session admin à 8 h.

const {
  findFirstMock,
  compareMock,
  checkRateLimitMock,
  recordAttemptMock,
  resetAttemptsMock,
  verifierChallengeMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  compareMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  recordAttemptMock: vi.fn(),
  resetAttemptsMock: vi.fn(),
  verifierChallengeMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => {
  const nextAuth = vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }))
  return { default: nextAuth }
})
vi.mock('@auth/prisma-adapter', () => ({
  PrismaAdapter: vi.fn(() => ({})),
}))
vi.mock('bcryptjs', () => ({
  default: { compare: compareMock },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: findFirstMock } },
}))
vi.mock('@/lib/rate-limit', () => ({
  LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER: 5,
  LOGIN_WINDOW_MS: 5 * 60 * 1_000,
  checkRateLimit: checkRateLimitMock,
  recordAttempt: recordAttemptMock,
  resetAttempts: resetAttemptsMock,
}))
vi.mock('@/lib/admin-auth', () => ({
  verifierChallengeAdmin: verifierChallengeMock,
}))

const ADMIN = {
  id: 14,
  name: 'Ada Admin',
  email: 'ada@example.cm',
  password: '$2b$12$hash',
  role: 'admin' as const,
  isActive: true,
  anonymizedAt: null,
  sessionVersion: 3,
}

const CANDIDAT = {
  ...ADMIN,
  id: 15,
  role: 'candidat' as const,
}

const IDENTIFIANTS = {
  identifier: 'ada@example.cm',
  password: 'MotDePasseAdmin123',
}

describe('autoriserIdentifiants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 })
    compareMock.mockResolvedValue(true)
    findFirstMock.mockResolvedValue(CANDIDAT)
  })

  it('refuse un admin même avec le bon mot de passe et compte la tentative', async () => {
    findFirstMock.mockResolvedValue(ADMIN)

    const resultat = await autoriserIdentifiants(IDENTIFIANTS)

    expect(resultat).toBeNull()
    expect(compareMock).toHaveBeenCalledWith(
      'MotDePasseAdmin123',
      expect.stringContaining('$2b$'),
    )
    expect(recordAttemptMock).toHaveBeenCalledWith('login:id:ada@example.cm')
    expect(resetAttemptsMock).not.toHaveBeenCalled()
  })

  it('ouvre une session candidat avec la version de session figée', async () => {
    const resultat = await autoriserIdentifiants(IDENTIFIANTS)

    expect(resultat).toEqual({
      id: '15',
      name: 'Ada Admin',
      email: 'ada@example.cm',
      role: 'candidat',
      sessionVersion: 3,
    })
    expect(resetAttemptsMock).toHaveBeenCalledWith('login:id:ada@example.cm')
  })

  it('refuse un compte suspendu, anonymisé ou inconnu', async () => {
    for (const compte of [
      { ...CANDIDAT, isActive: false },
      { ...CANDIDAT, anonymizedAt: new Date() },
      null,
    ]) {
      findFirstMock.mockResolvedValue(compte)
      expect(await autoriserIdentifiants(IDENTIFIANTS)).toBeNull()
    }
    expect(compareMock).toHaveBeenCalledWith(
      'MotDePasseAdmin123',
      expect.stringContaining('$2b$'),
    )
  })

  it('refuse quand le seau par identifiant est épuisé', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 10_000 })
    expect(await autoriserIdentifiants(IDENTIFIANTS)).toBeNull()
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it('refuse une charge utile malformée sans toucher à la base', async () => {
    expect(await autoriserIdentifiants({ identifier: '', password: '' })).toBeNull()
    expect(findFirstMock).not.toHaveBeenCalled()
  })
})

describe('appliquerClaimsJwt', () => {
  it('fige userId, rôle et sessionVersion', () => {
    const token = appliquerClaimsJwt({}, { id: '15', role: 'candidat', sessionVersion: 4 })

    expect(token).toMatchObject({
      userId: 15,
      role: 'candidat',
      sessionVersion: 4,
    })
  })

  it('plafonne une session admin à huit heures', () => {
    const avant = Math.floor(Date.now() / 1000)
    const token = appliquerClaimsJwt<{ exp?: number }>(
      {},
      { id: '14', role: 'admin', sessionVersion: 1 },
    )

    expect(token.exp).toBeGreaterThanOrEqual(avant + ADMIN_SESSION_MAX_AGE_SECONDS)
    expect(token.exp).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS,
    )
  })

  it('ne pose pas d’expiration admin sur un autre rôle', () => {
    const token = appliquerClaimsJwt<{ exp?: number }>(
      {},
      { id: '15', role: 'candidat', sessionVersion: 0 },
    )
    expect(token.exp).toBeUndefined()
  })
})

describe('autoriserChallengeAdmin', () => {
  it('transmet le jeton et le code au vérificateur unique', async () => {
    verifierChallengeMock.mockResolvedValue({ id: '14', role: 'admin' })

    await expect(
      autoriserChallengeAdmin({ challengeToken: 'jeton', code: '123456' }),
    ).resolves.toEqual({ id: '14', role: 'admin' })
    expect(verifierChallengeMock).toHaveBeenCalledWith({
      challengeToken: 'jeton',
      code: '123456',
    })
  })

  it('refuse une charge utile vide sans appeler la base', async () => {
    verifierChallengeMock.mockResolvedValue(null)
    await expect(autoriserChallengeAdmin(null)).resolves.toBeNull()
    expect(verifierChallengeMock).toHaveBeenCalledWith({
      challengeToken: undefined,
      code: undefined,
    })
  })
})
