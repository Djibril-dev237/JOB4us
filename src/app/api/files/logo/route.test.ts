import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'
import { signDownloadUrl } from '@/lib/storage'

import { GET } from './route'

// ─── Tests de la matrice d'accès logo (M3, étendue M5 option B) ─────────────
// Fail-closed conservé : propriétaire + admin en interne. M5 ouvre la
// branche PUBLIQUE sous condition stricte « entreprise avec au moins une
// offre visible » (prédicat unique de la DAL publique) — décision explicite
// de l'étape 3, jamais un effet de bord. Sans offre visible : 404 (aucune
// fuite d'existence). Signature 5 minutes `inline` inchangée ; le 302
// public est cachable 5 min, le 302 authentifié reste no-store.
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

/** Colonnes lues par la route sur Entreprise (logo + propriétaire). */
type EntrepriseLu = { logo: string | null; userId: number }

const { authMock, entrepriseFindUnique, offreCount } = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<MockSession | null>>(),
  entrepriseFindUnique: vi.fn<() => Promise<EntrepriseLu | null>>(),
  offreCount: vi.fn<(args: { where: unknown }) => Promise<number>>(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    entreprise: { findUnique: entrepriseFindUnique },
    offre: { count: offreCount },
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
  offreCount.mockResolvedValue(0)
})

describe('GET /api/files/logo — visiteur (option B)', () => {
  it('sert le 302 public si l’entreprise a au moins une offre visible', async () => {
    authMock.mockResolvedValue(null)
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)
    offreCount.mockResolvedValue(2)

    const response = await GET(logoRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(signDownloadUrl).toHaveBeenCalledWith({
      key: 'logos/uuid.jpg',
      filename: 'logo-3.jpg',
      contentType: 'image/jpeg',
      disposition: 'inline',
    })
    // Le compteur repose sur le prédicat unique (matrice de visibilité).
    expect(offreCount.mock.calls[0]?.[0].where).toMatchObject({
      AND: [
        {
          isActive: true,
          entreprise: { user: { isActive: true } },
        },
        { entrepriseId: 3 },
      ],
    })
  })

  it('répond 404 fail-closed quand aucune offre n’est visible', async () => {
    authMock.mockResolvedValue(null)
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)
    offreCount.mockResolvedValue(0)

    const response = await GET(logoRequest())

    expect(response.status).toBe(404)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(offreCount).toHaveBeenCalledTimes(1)
  })

  it('répond 404 sans requête de visibilité si l’entreprise n’existe pas', async () => {
    authMock.mockResolvedValue(null)
    entrepriseFindUnique.mockResolvedValue(null)

    expect((await GET(logoRequest('?entrepriseId=9999'))).status).toBe(404)
    expect(offreCount).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it('répond 404 si l’entreprise n’a pas de logo', async () => {
    authMock.mockResolvedValue(null)
    entrepriseFindUnique.mockResolvedValue({ logo: null, userId: 7 })

    expect((await GET(logoRequest())).status).toBe(404)
    expect(offreCount).not.toHaveBeenCalled()
  })

  it('valide le paramètre avant toute session et toute requête base (400)', async () => {
    authMock.mockResolvedValue(null)

    for (const query of ['', '?entrepriseId=abc', '?entrepriseId=0', '?entrepriseId=1.5']) {
      expect((await GET(logoRequest(query))).status).toBe(400)
    }
    expect(authMock).not.toHaveBeenCalled()
    expect(entrepriseFindUnique).not.toHaveBeenCalled()
    expect(offreCount).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/logo — paramètres (connecté)', () => {
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
    // La branche authentifiée ne consulte jamais la condition publique.
    expect(offreCount).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/logo — tiers', () => {
  it("refuse le logo d'une autre entreprise (403)", async () => {
    login(9, 'recruteur')
    entrepriseFindUnique.mockResolvedValue(AVEC_LOGO)

    const response = await GET(logoRequest())

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(offreCount).not.toHaveBeenCalled()
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
