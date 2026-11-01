import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialsSignin } from 'next-auth'
import { redirect } from 'next/navigation'

import { entrerCodeAdmin, reauthentifierAdmin } from './admin-auth'

// ─── Actions du second facteur et de la réauthentification (M10) ────────────
//
// Le formulaire 2FA ne reçoit jamais le jeton de challenge : il vit dans un
// cookie httpOnly. La réauthentification n'est jamais accordée sans code
// valide, et la cible de retour reste interne à /admin.

const {
  cookiesMock,
  cookieGetMock,
  cookieSetMock,
  cookieDeleteMock,
  signInMock,
  requireAdminMock,
  lireChallengeMock,
  verifierCodeSessionMock,
  auditMock,
  checkRateLimitMock,
  recordAttemptMock,
  resetAttemptsMock,
  creerJetonReauthMock,
} = vi.hoisted(() => {
  const cookieGetMock = vi.fn()
  const cookieSetMock = vi.fn()
  const cookieDeleteMock = vi.fn()
  return {
    cookiesMock: vi.fn(),
    cookieGetMock,
    cookieSetMock,
    cookieDeleteMock,
    signInMock: vi.fn(),
    requireAdminMock: vi.fn(),
    lireChallengeMock: vi.fn(),
    verifierCodeSessionMock: vi.fn(),
    auditMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    recordAttemptMock: vi.fn(),
    resetAttemptsMock: vi.fn(),
    creerJetonReauthMock: vi.fn(() => 'jeton-reauth'),
  }
})

vi.mock('next-auth', () => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
}))
vi.mock('@/auth', () => ({ signIn: signInMock }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))
vi.mock('next/headers', () => ({ cookies: cookiesMock }))
vi.mock('@/lib/dal', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/admin-auth', () => ({
  lireChallengeAdmin: lireChallengeMock,
  verifierCodeAdminPourSession: verifierCodeSessionMock,
}))
vi.mock('@/lib/journal-audit', () => ({ consignerAudit: auditMock }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
  recordAttempt: recordAttemptMock,
  resetAttempts: resetAttemptsMock,
}))
vi.mock('@/lib/admin-crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/admin-crypto')>()
  return {
    ...original,
    creerJetonReauth: creerJetonReauthMock,
  }
})

const CHALLENGE = {
  id: 'challenge-1',
  userId: 7,
  expiresAt: new Date(Date.now() + 60_000),
  user: { name: 'Ada Admin', email: 'ada@example.cm' },
}

function formDataCode(code: string, retour?: string): FormData {
  const formData = new FormData()
  formData.set('code', code)
  if (retour !== undefined) formData.set('retour', retour)
  return formData
}

describe('entrerCodeAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieGetMock.mockReturnValue({ value: 'jeton-challenge' })
    cookiesMock.mockResolvedValue({
      get: cookieGetMock,
      set: cookieSetMock,
      delete: cookieDeleteMock,
    })
    lireChallengeMock.mockResolvedValue(CHALLENGE)
    signInMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)
  })

  it('refuse sans cookie de challenge et renvoie vers /login', async () => {
    cookieGetMock.mockReturnValue(undefined)
    await expect(entrerCodeAdmin({}, formDataCode('123456'))).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login?error=1')
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('refuse un code trop court sans appeler Auth.js', async () => {
    const resultat = await entrerCodeAdmin({}, formDataCode('123'))
    expect(resultat.errors?.code?.[0]).toContain('6 chiffres')
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('refuse un challenge inconnu, expiré ou consommé', async () => {
    lireChallengeMock.mockResolvedValue(null)
    await expect(entrerCodeAdmin({}, formDataCode('123456'))).rejects.toThrow('NEXT_REDIRECT')
    expect(cookieDeleteMock).toHaveBeenCalledWith('job4us.admin.challenge')
    expect(redirect).toHaveBeenCalledWith('/login?error=1')
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('ouvre la session, pose le grant de réauthentification et trace la connexion', async () => {
    await expect(entrerCodeAdmin({}, formDataCode('123456'))).rejects.toThrow('NEXT_REDIRECT')

    expect(signInMock).toHaveBeenCalledWith('admin-challenge', {
      challengeToken: 'jeton-challenge',
      code: '123456',
      redirect: false,
    })
    expect(cookieSetMock).toHaveBeenCalledWith(
      'job4us.admin.reauth',
      'jeton-reauth',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    )
    expect(cookieDeleteMock).toHaveBeenCalledWith('job4us.admin.challenge')
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: 7,
        action: 'connexion_admin',
        cibleType: 'admin',
        cibleId: 7,
      }),
    )
    expect(redirect).toHaveBeenCalledWith('/admin/dashboard')
  })

  it('code refusé par Auth.js : message générique, aucun grant', async () => {
    signInMock.mockRejectedValue(new CredentialsSignin())
    const resultat = await entrerCodeAdmin({}, formDataCode('123456'))

    expect(resultat.message).toBe('Code invalide ou expiré.')
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('reauthentifierAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ userId: 7, role: 'admin', sessionVersion: 1 })
    verifierCodeSessionMock.mockResolvedValue(true)
    auditMock.mockResolvedValue(undefined)
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 })
    cookiesMock.mockResolvedValue({
      get: vi.fn(),
      set: cookieSetMock,
      delete: vi.fn(),
    })
  })

  it('non-admin : 404 avant le rate limit et toute vérification de code', async () => {
    requireAdminMock.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'))

    await expect(
      reauthentifierAdmin({}, formDataCode('123456')),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(verifierCodeSessionMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('refuse quand le seau de réauthentification est épuisé', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 60_000 })
    const resultat = await reauthentifierAdmin({}, formDataCode('123456'))

    expect(resultat.message).toContain('Trop de tentatives')
    expect(verifierCodeSessionMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
  })

  it('refuse un code invalide et compte la tentative', async () => {
    verifierCodeSessionMock.mockResolvedValue(false)
    const resultat = await reauthentifierAdmin({}, formDataCode('123456'))

    expect(resultat.message).toBe('Code invalide ou expiré.')
    expect(recordAttemptMock).toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('accorde cinq minutes et revient à la cible admin interne', async () => {
    await expect(
      reauthentifierAdmin({}, formDataCode('123456', '/admin/signalements/3')),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(cookieSetMock).toHaveBeenCalledWith(
      'job4us.admin.reauth',
      'jeton-reauth',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    )
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'reauthentification_admin', acteurId: 7 }),
    )
    expect(redirect).toHaveBeenCalledWith('/admin/signalements/3')
  })

  it('refuse une cible externe ou hors admin', async () => {
    await expect(
      reauthentifierAdmin({}, formDataCode('123456', 'https://evil.example')),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/dashboard')
  })
})
