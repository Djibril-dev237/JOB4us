import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'
import { signDownloadUrl } from '@/lib/storage'

import { GET } from './route'

// ─── Tests de la matrice d'accès logo (M3-ST9) ───────────────────────────────
// Fail-closed identique à l'avatar : propriétaire de l'entreprise + admin
// uniquement. Le legacy diffusait les logos en clair depuis /storage/logos
// (URL devinable) — ici : session d'abord, 403 pour tout tiers, signature
// de 5 minutes avec `inline` justifié (raster blanchi + nosniff).
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

/** Colonnes lues par la route sur Entreprise (logo + propriétaire). */
type EntrepriseLu = { logo: string | null; userId: number }

const { authMock, entrepriseFindUnique } = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<MockSession | null>>(),
  entrepriseFindUnique: vi.fn<() => Promise<EntrepriseLu | null>>(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    entreprise: { findUnique: entrepriseFindUnique },
  },
}))
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return { ...actual, signDownloadUrl: vi.fn() }
})

const SIGNED_URL = 'https://r2.example/bucket/logos/uuid.jpg?X-Amz-Signature=abc'
const AVEC_LOGO: EntrepriseLu = { logo: 'logos/uuid.jpg', userId: 7 }

function login(id: number, role: Role): void {
  authMock.mockResolvedValue({
    user: { id, role },
    expires: '2100-01-01T00:00:00.000Z',
  })
}

function logoRequest(query = '?entrepriseId=3'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/files/logo${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signDownloadUrl).mockResolvedValue(SIGNED_URL)
})

describe('GET /api/files/logo — visiteur', () => {
  it('refuse un non connecté par 401, avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(logoRequest())

    expect(response.status).toBe(401)
    expect(entrepriseFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/logo — paramètres', () => {
  it('refuse un paramètre absent, non numérique ou nul (400)', async () => {
    login(7, 'recruteur')

    for (const query of ['', '?entrepriseId=abc', '?entrepriseId=0', '?entrepriseId=-2', '?entrepriseId=1.5']) {
      expect((await GET(logoRequest(query))).status).toBe(400)
    }
    expect(entrepriseFindUnique).not.toHaveBeenCalled()
  })

  it("répond 404 quand l'entreprise ou son logo n'existe pas", async () => {
    login(7, 'recruteur')
    entrepriseFindUnique.mockResolvedValue(null)
    expect((await GET(logoRequest('?entrepriseId=9999'))).status).toBe(404)

    entrepriseFindUnique.mockResolvedValue({ logo: null, userId: 7 })
    expect((await GET(logoRequest())).status).toBe(404)
  })
})

describe('GET /api/files/logo — propriétaire', () => {
  it('autorise son propre logo : 302 + URL signée no-store + inline', async () => {
    login(7, 'recruteur')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    const response = await GET(logoRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(signDownloadUrl).toHaveBeenCalledWith({
      key: 'logos/uuid.jpg',
      filename: 'logo-3.jpg',
      contentType: 'image/jpeg',
      disposition: 'inline',
    })
  })
})

describe('GET /api/files/logo — tiers', () => {
  it("refuse le logo d'une autre entreprise (403)", async () => {
    login(9, 'recruteur')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    const response = await GET(logoRequest())

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it('répond 403 malgré un champ role=admin tenté dans la query string', async () => {
    login(9, 'recruteur')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    const response = await GET(logoRequest('?entrepriseId=3&role=admin'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it('refuse aussi un candidat et un admin non authentifié en rôle réel', async () => {
    login(5, 'candidat')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    expect((await GET(logoRequest())).status).toBe(403)
  })
})

describe('GET /api/files/logo — admin', () => {
  it('autorise toujours : 302 vers URL signée', async () => {
    login(1, 'admin')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    const response = await GET(logoRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
  })
})
