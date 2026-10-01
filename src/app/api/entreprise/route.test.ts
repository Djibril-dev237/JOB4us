import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '@/lib/definitions'

import { GET } from './route'

// ─── Tests de la route GET /api/entreprise (M3-ST9) ──────────────────────────
// Lecture strictement « moi » au rôle recruteur : 401 visiteur, 403 candidat
// et admin (leur espace est ailleurs), aucun chemin vers une autre entreprise
// (aucun identifiant dans la route). Le logo ne sort que sous forme de chemin
// interne /api/files/logo — jamais de clé R2 ni d'URL signée.
// ---------------------------------------------------------------------------

type MockSession = { user: { id: number; role: Role }; expires: string }

interface EntrepriseRow {
  id: number
  nom: string
  secteurActivite: string | null
  tailleEntreprise: string | null
  description: string | null
  siteWeb: string | null
  emailContact: string | null
  telephone: string | null
  adresse: string | null
  ville: string | null
  pays: string
  logo: string | null
  isVerified: boolean
  updatedAt: Date
}

type UserLu = { name: string; entreprise: EntrepriseRow | null }

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

const ENTREPRISE: EntrepriseRow = {
  id: 3,
  nom: 'ACME Cameroun',
  secteurActivite: 'Technologie',
  tailleEntreprise: '11-50',
  description: 'Société de services.',
  siteWeb: 'https://acme.cm',
  emailContact: 'contact@acme.cm',
  telephone: '+237699999999',
  adresse: 'Rue 1.23, Bonanjo',
  ville: 'Douala',
  pays: 'Cameroun',
  logo: 'logos/uuid.png',
  isVerified: false,
  updatedAt: new Date('2026-01-15T12:00:00.000Z'),
}

function login(id: number, role: Role): void {
  authMock.mockResolvedValue({
    user: { id, role },
    expires: '2100-01-01T00:00:00.000Z',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/entreprise — accès', () => {
  it('refuse un non connecté par 401, avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it("refuse un candidat par 403 (son profil est ailleurs)", async () => {
    login(5, 'candidat')

    const response = await GET()

    expect(response.status).toBe(403)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('refuse un admin par 403 (espace réservé aux recruteurs)', async () => {
    login(1, 'admin')

    expect((await GET()).status).toBe(403)
  })
})

describe('GET /api/entreprise — recruteur', () => {
  it('renvoie les champs + chemin logo interne, en no-store', async () => {
    login(7, 'recruteur')
    userFindUnique.mockResolvedValue({ name: 'Test Recruteur', entreprise: ENTREPRISE })

    const response = await GET()
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body).toEqual({
      nom: 'ACME Cameroun',
      secteurActivite: 'Technologie',
      tailleEntreprise: '11-50',
      description: 'Société de services.',
      siteWeb: 'https://acme.cm',
      emailContact: 'contact@acme.cm',
      telephone: '+237699999999',
      adresse: 'Rue 1.23, Bonanjo',
      ville: 'Douala',
      pays: 'Cameroun',
      // Chemin INTERNE vers la route à matrice — jamais de clé R2 ni
      // d'URL signée dans la réponse.
      logoUrl: '/api/files/logo?entrepriseId=3',
      logoUpdatedAt: '2026-01-15T12:00:00.000Z',
      isVerified: false,
    })
    expect(JSON.stringify(body)).not.toContain('logos/')
  })

  it('ligne absente : nom = nom du compte (valeur réelle), logoUrl null', async () => {
    login(7, 'recruteur')
    userFindUnique.mockResolvedValue({ name: 'Jean Recruteur', entreprise: null })

    const response = await GET()
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.nom).toBe('Jean Recruteur')
    expect(body.logoUrl).toBeNull()
    expect(body.pays).toBe('')
    expect(body.isVerified).toBe(false)
  })

  it('404 si le compte a disparu', async () => {
    login(7, 'recruteur')
    userFindUnique.mockResolvedValue(null)

    expect((await GET()).status).toBe(404)
  })
})
