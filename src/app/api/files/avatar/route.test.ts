import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'
import { signDownloadUrl } from '@/lib/storage'

import { GET } from './route'

// ─── Tests de la matrice d'accès avatar (Étape 2 validée) ────────────────────
// Matrice volontairement stricte : propriétaire + admin uniquement ; aucun
// tiers n'accède à l'avatar d'autrui tant qu'une décision explicite ne
// l'élargit pas (aucune vue publique de profil n'existe — décision Étape 2).
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

/** Colonne lue par la route sur User (select avatar). */
type UserLu = { avatar: string | null }

const { authMock, userFindUnique } = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<MockSession | null>>(),
  userFindUnique: vi.fn<() => Promise<UserLu | null>>(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
  },
}))
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return { ...actual, signDownloadUrl: vi.fn() }
})

const SIGNED_URL = 'https://r2.example/bucket/avatars/uuid.png?X-Amz-Signature=abc'
const AVEC_AVATAR: UserLu = { avatar: 'avatars/uuid.png' }

function login(id: number, role: Role): void {
  authMock.mockResolvedValue({
    user: { id, role },
    expires: '2100-01-01T00:00:00.000Z',
  })
}

function avatarRequest(query = '?userId=7'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/files/avatar${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signDownloadUrl).mockResolvedValue(SIGNED_URL)
})

describe('GET /api/files/avatar — visiteur', () => {
  it('refuse un non connecté par 401, avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(avatarRequest())

    expect(response.status).toBe(401)
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/avatar — paramètres', () => {
  it('refuse un paramètre absent, non numérique ou nul (400)', async () => {
    login(1, 'candidat')

    for (const query of ['', '?userId=abc', '?userId=0', '?userId=-2', '?userId=1.5']) {
      expect((await GET(avatarRequest(query))).status).toBe(400)
    }
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it("répond 404 quand le compte ou l'avatar n'existe pas", async () => {
    login(7, 'candidat')
    userFindUnique.mockResolvedValue(null)
    expect((await GET(avatarRequest('?userId=9999'))).status).toBe(404)

    userFindUnique.mockResolvedValue({ avatar: null })
    expect((await GET(avatarRequest())).status).toBe(404)
  })
})

describe('GET /api/files/avatar — propriétaire (ligne 2)', () => {
  it('autorise son propre avatar : 302 + URL signée no-store', async () => {
    login(7, 'candidat')
    userFindUnique.mockResolvedValue(AVEC_AVATAR)

    const response = await GET(avatarRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(signDownloadUrl).toHaveBeenCalledWith({
      key: 'avatars/uuid.png',
      filename: 'avatar-7.png',
      contentType: 'image/png',
    })
  })
})

describe('GET /api/files/avatar — tiers (lignes 3-4)', () => {
  it("refuse l'avatar d'un autre compte (403)", async () => {
    login(8, 'candidat')
    userFindUnique.mockResolvedValue(AVEC_AVATAR)

    const response = await GET(avatarRequest())

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it('répond 403 malgré un champ role=admin tenté dans la query string', async () => {
    login(8, 'recruteur')
    userFindUnique.mockResolvedValue(AVEC_AVATAR)

    const response = await GET(avatarRequest('?userId=7&role=admin'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("refuse aussi un recruteur (aucun tiers tant que la matrice ne l'a pas élargi)", async () => {
    login(3, 'recruteur')
    userFindUnique.mockResolvedValue(AVEC_AVATAR)

    expect((await GET(avatarRequest())).status).toBe(403)
  })
})

describe('GET /api/files/avatar — admin (ligne 5)', () => {
  it('autorise toujours : 302 vers URL signée', async () => {
    login(1, 'admin')
    userFindUnique.mockResolvedValue(AVEC_AVATAR)

    const response = await GET(avatarRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
  })
})
