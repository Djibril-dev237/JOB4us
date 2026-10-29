import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'

import { login } from './auth'

// ─── Branche admin de la connexion (M10) ────────────────────────────────────
//
// Le provider credentials ordinaire refuse les admins (testé dans auth.test.ts
// côté Auth.js). Ici : l'action de connexion ne doit ouvrir un challenge que
// pour un admin ACTIF, ACTIVÉ (TOTP) et NON ANONYMISÉ, avec le bon mot de
// passe. Tout autre cas renvoie le message générique, sans cookie ni
// redirection vers /login/2fa.

const {
  signInMock,
  checkRateLimitMock,
  recordAttemptMock,
  findFirstMock,
  verifyPasswordMock,
  creerChallengeAdminMock,
  cookieSetMock,
} = vi.hoisted(() => ({
  signInMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  recordAttemptMock: vi.fn(),
  findFirstMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
  creerChallengeAdminMock: vi.fn(),
  cookieSetMock: vi.fn(),
}))

vi.mock('next-auth', () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}))

vi.mock('@/auth', () => ({
  signIn: signInMock,
  signOut: vi.fn(),
  verifyPassword: verifyPasswordMock,
}))

vi.mock('@/lib/admin-auth', () => ({
  creerChallengeAdmin: creerChallengeAdminMock,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: cookieSetMock,
    delete: vi.fn(),
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: findFirstMock } },
}))

vi.mock('@/lib/rate-limit', () => ({
  LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER: 5,
  LOGIN_MAX_ATTEMPTS_PER_IP: 30,
  LOGIN_WINDOW_MS: 5 * 60 * 1_000,
  checkRateLimit: checkRateLimitMock,
  recordAttempt: recordAttemptMock,
  resetAttempts: vi.fn(),
}))

function formulaireAdmin(): FormData {
  const formData = new FormData()
  formData.set('identifier', 'admin@example.cm')
  formData.set('password', 'MotDePasseAdmin123')
  return formData
}

const ADMIN_ACTIF = {
  id: 7,
  role: 'admin' as const,
  password: '$2b$12$hash',
  isActive: true,
  totpEnabledAt: new Date(),
  anonymizedAt: null,
}

describe('login — challenge admin (M10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 })
    findFirstMock.mockResolvedValue(ADMIN_ACTIF)
    verifyPasswordMock.mockResolvedValue(true)
    creerChallengeAdminMock.mockResolvedValue({
      token: 'jeton-challenge',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
  })

  it('ouvre un challenge et pose un cookie httpOnly pour un admin valide', async () => {
    await expect(login(undefined, formulaireAdmin())).rejects.toThrow('NEXT_REDIRECT')

    expect(creerChallengeAdminMock).toHaveBeenCalledWith(7)
    expect(cookieSetMock).toHaveBeenCalledWith(
      'job4us.admin.challenge',
      'jeton-challenge',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    )
    expect(signInMock).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith('/login/2fa')
  })

  it('refuse un admin sans TOTP activé sans créer de challenge', async () => {
    findFirstMock.mockResolvedValue({ ...ADMIN_ACTIF, totpEnabledAt: null })

    const resultat = await login(undefined, formulaireAdmin())

    expect(resultat).toEqual({ message: 'Email ou mot de passe incorrect.' })
    expect(creerChallengeAdminMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('refuse un admin suspendu ou anonymisé sans créer de challenge', async () => {
    findFirstMock.mockResolvedValue({ ...ADMIN_ACTIF, isActive: false })
    expect(await login(undefined, formulaireAdmin())).toEqual({
      message: 'Email ou mot de passe incorrect.',
    })

    findFirstMock.mockResolvedValue({
      ...ADMIN_ACTIF,
      anonymizedAt: new Date(),
    })
    expect(await login(undefined, formulaireAdmin())).toEqual({
      message: 'Email ou mot de passe incorrect.',
    })
    expect(creerChallengeAdminMock).not.toHaveBeenCalled()
  })

  it('refuse un mauvais mot de passe sans révéler le compte', async () => {
    verifyPasswordMock.mockResolvedValue(false)

    const resultat = await login(undefined, formulaireAdmin())

    expect(resultat).toEqual({ message: 'Email ou mot de passe incorrect.' })
    expect(creerChallengeAdminMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('laisse le parcours candidat/recruteur au provider credentials', async () => {
    findFirstMock.mockResolvedValue({
      ...ADMIN_ACTIF,
      role: 'candidat',
    })

    await expect(login(undefined, formulaireAdmin())).rejects.toThrow('NEXT_REDIRECT')

    expect(creerChallengeAdminMock).not.toHaveBeenCalled()
    expect(signInMock).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ identifier: 'admin@example.cm' }),
    )
  })
})
