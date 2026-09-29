import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'
import { logCvAccess } from '@/lib/audit'
import { signDownloadUrl } from '@/lib/storage'

import { GET } from './route'

// ─── Tests de la matrice d'accès CV (Étape 2 validée) ────────────────────────
// Chaque ligne de la matrice a son test ; le contrôle est injecté par les
// mocks (session = auth(), données = prisma) : le client ne peut FORGER ni le
// rôle ni l'id, ils proviennent exclusivement du cookie de session.
// Les mocks sont typés via vi.hoisted pour refléter ce que la route lit
// réellement (après `select`), sans cast.
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

/** Colonnes lues par la route sur Candidat (select id, userId, cvPath). */
type CandidatLu = { id: number; userId: number; cvPath: string | null }

const { authMock, candidatFindUnique, candidatureFindFirst } = vi.hoisted(() => ({
  authMock: vi.fn<() => Promise<MockSession | null>>(),
  candidatFindUnique: vi.fn<() => Promise<CandidatLu | null>>(),
  candidatureFindFirst: vi.fn<() => Promise<{ id: number } | null>>(),
}))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidat: { findUnique: candidatFindUnique },
    candidature: { findFirst: candidatureFindFirst },
    accesFichier: { create: vi.fn() },
  },
}))
vi.mock('@/lib/audit')
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return { ...actual, signDownloadUrl: vi.fn() }
})

const SIGNED_URL = 'https://r2.example/bucket/cvs/uuid.pdf?X-Amz-Signature=abc'

/** Cible : profil CV de l'utilisateur 42, clé R2 privé. */
const CIBLE: CandidatLu = { id: 5, userId: 42, cvPath: 'cvs/aaaa-bbbb.pdf' }

function login(id: number, role: Role): void {
  authMock.mockResolvedValue({
    user: { id, role },
    expires: '2100-01-01T00:00:00.000Z',
  })
}

function cvRequest(query = '?candidatId=5'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/files/cv${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signDownloadUrl).mockResolvedValue(SIGNED_URL)
  vi.mocked(logCvAccess).mockResolvedValue(undefined)
})

describe('GET /api/files/cv — visiteur (ligne 1 de la matrice)', () => {
  it('refuse un non connecté par 401, avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(cvRequest())

    expect(response.status).toBe(401)
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/cv — paramètres', () => {
  it('refuse un paramètre absent, non numérique, négatif ou décimal (400)', async () => {
    login(1, 'candidat')

    for (const query of ['', '?candidatId=abc', '?candidatId=-1', '?candidatId=1.5', '?candidatId=0']) {
      const response = await GET(cvRequest(query))
      expect(response.status).toBe(400)
    }
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it("répond 404 quand le profil ou le CV n'existe pas", async () => {
    login(1, 'candidat')
    candidatFindUnique.mockResolvedValue(null)

    expect((await GET(cvRequest('?candidatId=9999'))).status).toBe(404)

    candidatFindUnique.mockResolvedValue({ ...CIBLE, cvPath: null })
    expect((await GET(cvRequest())).status).toBe(404)
  })
})

describe('GET /api/files/cv — candidat (lignes 2-3)', () => {
  it('autorise son propre CV : 302 vers URL signée, sans journal', async () => {
    login(42, 'candidat')
    candidatFindUnique.mockResolvedValue(CIBLE)

    const response = await GET(cvRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(signDownloadUrl).toHaveBeenCalledWith({
      key: CIBLE.cvPath,
      filename: 'cv-5.pdf',
      contentType: 'application/pdf',
    })
    // Le propriétaire n'est pas un événement sensible (matrice Étape 2).
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(candidatureFindFirst).not.toHaveBeenCalled()
  })

  it("refuse le CV d'un autre candidat (403), sans diffusion ni journal", async () => {
    login(7, 'candidat')
    candidatFindUnique.mockResolvedValue(CIBLE)

    const response = await GET(cvRequest())

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/cv — recruteur (lignes 4-5)', () => {
  it('autorise SI postulé à une de ses offres : 302 + journal', async () => {
    login(3, 'recruteur')
    candidatFindUnique.mockResolvedValue(CIBLE)
    candidatureFindFirst.mockResolvedValue({ id: 11 })

    const response = await GET(cvRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    // La condition relationnelle est évaluée en base, jamais côté client.
    expect(candidatureFindFirst).toHaveBeenCalledWith({
      where: { candidatId: CIBLE.id, offre: { entreprise: { userId: 3 } } },
      select: { id: true },
    })
    // Journal : recruteur/admin uniquement, AVANT diffusion (fail-closed).
    expect(logCvAccess).toHaveBeenCalledWith(3, 5)
  })

  it("refuse si aucune candidature à ses offres (403), sans journal", async () => {
    login(3, 'recruteur')
    candidatFindUnique.mockResolvedValue(CIBLE)
    candidatureFindFirst.mockResolvedValue(null)

    const response = await GET(cvRequest())

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it('répond 403 malgré un champ role=admin tenté dans la query string', async () => {
    login(3, 'recruteur')
    candidatFindUnique.mockResolvedValue(CIBLE)
    candidatureFindFirst.mockResolvedValue(null)

    const response = await GET(cvRequest('?candidatId=5&role=admin'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/cv — admin (ligne 6)', () => {
  it('autorise toujours : 302 + journal', async () => {
    login(1, 'admin')
    candidatFindUnique.mockResolvedValue(CIBLE)

    const response = await GET(cvRequest())

    expect(response.status).toBe(302)
    expect(logCvAccess).toHaveBeenCalledWith(1, 5)
    expect(candidatureFindFirst).not.toHaveBeenCalled()
  })
})

describe('GET /api/files/cv — journal fail-closed', () => {
  it("échec du journal = pas d'URL signée (l'erreur se propage)", async () => {
    login(3, 'recruteur')
    candidatFindUnique.mockResolvedValue(CIBLE)
    candidatureFindFirst.mockResolvedValue({ id: 11 })
    vi.mocked(logCvAccess).mockRejectedValueOnce(new Error('journal indisponible'))

    await expect(GET(cvRequest())).rejects.toThrow('journal indisponible')
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})
