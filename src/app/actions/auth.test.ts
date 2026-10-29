import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialsSignin } from 'next-auth'
import { redirect } from 'next/navigation'

import { login } from './auth'
// ─── Tests de l'action `login` : cible post-connexion (M1 + contrôle M7) ─────
//
// Verrouillé ici : la page de connexion reçoit `?redirect=<chemin>` (parcours
// de postulation M7 : /offres/<slug>/postuler) et le formulaire transmet ce
// champ caché ; l'ACTION revalide la cible côté serveur (anti open-redirect,
// cf. src/lib/redirect.ts) — le client n'est jamais la source de vérité.
// Critères :
// 1. cible interne validée → redirection suivie à l'identique ;
// 2. TOUT vecteur d'ouverture vers une origine étrangère → `/`, sans oracle ;
// 3. échec de connexion → AUCUNE redirection (le message d'erreur revient) ;
// 4. seau de rate limit dépassé → AUCUNE redirection.
// Auth.js, next/navigation, next/headers, prisma et le seau sont mockés —
// le helper `redirectionInterne` est testé en RÉEL (c'est le contrôle).
// ---------------------------------------------------------------------------

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

// Le vrai package next-auth ne se charge pas sous vitest (résolution
// `next/server` depuis lib/env.js) : la classe est remplacée par un double
// fidèle (extends Error), de même identité pour l'action et le test.
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
  redirect: vi.fn(),
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

/** Formulaire de connexion minimal, avec cible `redirect` optionnelle. */
function formConnexion(redirectValeur?: string | File): FormData {
  const formData = new FormData()
  formData.set('identifier', 'candidat@example.cm')
  formData.set('password', 'MotDePasse123')
  if (redirectValeur !== undefined) {
    formData.set('redirect', redirectValeur)
  }
  return formData
}

describe('login — cible de redirection post-connexion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInMock.mockResolvedValue(undefined)
    findFirstMock.mockResolvedValue(null)
    verifyPasswordMock.mockResolvedValue(false)
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  })

  it('suit une cible interne validée (usage M7 : postuler)', async () => {
    await login(undefined, formConnexion('/offres/developpeur-web-1/postuler'))

    expect(redirect).toHaveBeenCalledWith('/offres/developpeur-web-1/postuler')
  })

  it('retombe sur / quand aucun champ redirect n’est présent', async () => {
    await login(undefined, formConnexion())

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('retombe sur / pour un champ non textuel (fichier forger dans le formulaire)', async () => {
    await login(undefined, formConnexion(new File(['x'], 'x.txt', { type: 'text/plain' })))

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it.each([
    ['URL absolue', 'https://evil.example'],
    ['URL absolue http', 'http://evil.example'],
    ['protocole-relatif', '//evil.example'],
    ['antislash d’évasion', '/\\evil.example'],
    ['schéma javascript', 'javascript:alert(1)'],
    ['host nu', 'evil.example'],
    ['injection d’en-tête', '/offres\r\nSet-Cookie: x=1'],
    ['cible trop longue', `/${'a'.repeat(1024)}`],
  ])('retombe sur / pour une cible externe ou malformée (%s)', async (_libelle, cible) => {
    await login(undefined, formConnexion(cible))

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('échec de connexion : message générique et AUCUNE redirection', async () => {
    signInMock.mockRejectedValue(new CredentialsSignin())

    const resultat = await login(undefined, formConnexion('/offres/x/postuler'))

    expect(resultat).toEqual({ message: 'Email ou mot de passe incorrect.' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('seau dépassé : message de temporisation et AUCUNE redirection', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false, retryAfterMs: 90_000 })

    const resultat = await login(undefined, formConnexion('/offres/x/postuler'))

    expect(resultat).toEqual({
      message: 'Trop de tentatives de connexion. Réessayez dans 2 minute(s).',
    })
    expect(redirect).not.toHaveBeenCalled()
  })
})
