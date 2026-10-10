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

/**
 * Colonnes lues par la route sur Candidature (select id, cvPath,
 * candidat.id/userId, offre.entreprise.userId) — une SEULE lecture porte le
 * contrôle du mode `?candidature=`.
 */
type CandidatureLu = {
  id: number
  cvPath: string | null
  candidat: { id: number; userId: number }
  offre: { entreprise: { userId: number } }
}

const { authMock, auditCandidatureCreate, candidatFindUnique, candidatureFindFirst, candidatureFindUnique } =
  vi.hoisted(() => ({
    authMock: vi.fn<() => Promise<MockSession | null>>(),
    auditCandidatureCreate: vi.fn(),
    candidatFindUnique: vi.fn<() => Promise<CandidatLu | null>>(),
    candidatureFindFirst: vi.fn<() => Promise<{ id: number } | null>>(),
    candidatureFindUnique: vi.fn<() => Promise<CandidatureLu | null>>(),
  }))

vi.mock('@/auth', () => ({ auth: authMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidat: { findUnique: candidatFindUnique },
    candidature: {
      findFirst: candidatureFindFirst,
      findUnique: candidatureFindUnique,
    },
    accesFichier: { create: vi.fn() },
    auditCandidature: { create: auditCandidatureCreate },
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

/**
 * Clé du SNAPSHOT rattaché à la candidature — VOLONTAIREMENT distincte de
 * `CIBLE.cvPath` pour prouver que le mode `?candidature=` sert la pièce
 * jointe figée et jamais le cvPath actuel du profil.
 */
const SNAPSHOT = 'candidatures/1111-2222-3333.pdf'

/** Ligne 11 : candidat 5 (userId 42), offres du recruteur (userId 3). */
const CANDIDATURE: CandidatureLu = {
  id: 11,
  cvPath: SNAPSHOT,
  candidat: { id: 5, userId: 42 },
  offre: { entreprise: { userId: 3 } },
}

/** Select exact de la lecture unique du mode `?candidature=`. */
const SELECT_CANDIDATURE = {
  id: true,
  cvPath: true,
  candidat: { select: { id: true, userId: true } },
  offre: { select: { entreprise: { select: { userId: true } } } },
}

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
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
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
    // Mode PROFIL : AUCUNE ligne d'audit (aucun candidatureId possible).
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
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
    // Mode PROFIL : l'audit de candidature n'écrit jamais ici.
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
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

// ─── M7 : pièce jointe FIGÉE d'une candidature (`?candidature=<id>`) ─────────
// Le CV servi est `Candidature.cvPath` (le snapshot de la LIGNE), jamais le
// `candidat.cvPath` du profil : les deux clés sont mockées et DISTINCTES pour
// que toute confusion échoue l'assertion.
// ---------------------------------------------------------------------------

describe('GET /api/files/cv — pièce jointe de candidature (lignes M7)', () => {
  it("sert le SNAPSHOT de la ligne du candidat connecté : 302, sans journal", async () => {
    login(42, 'candidat')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // La clé signée est celle de LA LIGNE, pas celle du profil.
    expect(signDownloadUrl).toHaveBeenCalledWith({
      key: SNAPSHOT,
      filename: 'cv-candidature-11.pdf',
      contentType: 'application/pdf',
    })
    expect(signDownloadUrl).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: CIBLE.cvPath }),
    )
    // Lecture unique sur la ligne : le profil n'est pas touché.
    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: 11 },
      select: SELECT_CANDIDATURE,
    })
    expect(candidatFindUnique).not.toHaveBeenCalled()
    // Le propriétaire n'est pas un événement sensible : AUCUNE écriture
    // AuditCandidature (politique identique à logCvAccess).
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("refuse la candidature d'un autre candidat : 403, sans journal ni signature", async () => {
    login(7, 'candidat')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it("autorise le recruteur dont l'offre porte la candidature : 302 + journal AVANT signature", async () => {
    login(3, 'recruteur')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)
    const ordre: string[] = []
    vi.mocked(logCvAccess).mockImplementation(async () => {
      ordre.push('journal')
    })
    vi.mocked(signDownloadUrl).mockImplementation(async () => {
      ordre.push('signature')
      return SIGNED_URL
    })

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    // Journal AVANT toute diffusion (fail-closed) : le recruteur (3) est
    // l'acteur, le CANDIDAT propriétaire de la ligne (5) est la cible.
    expect(logCvAccess).toHaveBeenCalledWith(3, 5)
    expect(ordre).toEqual(['journal', 'signature'])
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindFirst).not.toHaveBeenCalled()
  })

  it("refuse un recruteur sans offre liée : 403, sans journal ni signature", async () => {
    login(9, 'recruteur')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it("autorise l'admin : 302 + journal sur le candidat propriétaire", async () => {
    login(1, 'admin')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    expect(logCvAccess).toHaveBeenCalledWith(1, 5)
    expect(signDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key: SNAPSHOT, filename: 'cv-candidature-11.pdf' }),
    )
  })

  it('répond 401 à un visiteur avant toute requête base', async () => {
    authMock.mockResolvedValue(null)

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(401)
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it("répond 404 quand la candidature n'existe pas, sans diffusion ni journal", async () => {
    login(42, 'candidat')
    candidatureFindUnique.mockResolvedValue(null)

    const response = await GET(cvRequest('?candidature=9999'))

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it('répond 404 quand la ligne est sans pièce jointe (cvPath null)', async () => {
    login(42, 'candidat')
    candidatureFindUnique.mockResolvedValue({ ...CANDIDATURE, cvPath: null })

    const response = await GET(cvRequest('?candidature=11'))

    // Indiscernable du 404 précédent : aucune fuite d'existence.
    expect(response.status).toBe(404)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })
})

// ─── V3-I : ligne `consultation` du journal AuditCandidature ─────────────────
// Écrite PAR LE MÊME couple (recruteur/admin, mode `?candidature=`) que le
// journal d'accès, mais rattachée à la LIGNE : `candidatureId` est non
// nullable, donc aucun mode profil ni aucun propriétaire n'écrit ici.
// ---------------------------------------------------------------------------

describe('GET /api/files/cv — audit AuditCandidature (V3-I)', () => {
  beforeEach(() => {
    login(3, 'recruteur')
    candidatureFindUnique.mockResolvedValue(CANDIDATURE)
  })

  it('mode ?candidature= recruteur : `consultation` écrite après logCvAccess, avant la signature', async () => {
    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(302)
    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: 11,
        // Acteur = userId de la session (3), JAMAIS le candidat propriétaire (5).
        acteurId: 3,
        action: 'consultation',
        ancienStatut: null,
        nouveauStatut: null,
      },
    })
    // Fail-closed : accès fichier → audit → signature (aucune URL sans trace).
    const ordreJournal = vi.mocked(logCvAccess).mock.invocationCallOrder[0] ?? 0
    const ordreAudit = auditCandidatureCreate.mock.invocationCallOrder[0] ?? 0
    const ordreSignature = vi.mocked(signDownloadUrl).mock.invocationCallOrder[0] ?? 0
    expect(ordreAudit).toBeGreaterThan(ordreJournal)
    expect(ordreSignature).toBeGreaterThan(ordreAudit)
  })

  it('mode ?candidature= admin : même écriture, acteur = userId admin', async () => {
    login(1, 'admin')

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(302)
    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acteurId: 1 }) }),
    )
  })

  it("refus 403 (candidature d’autrui) : AUCUNE écriture d’audit", async () => {
    login(9, 'recruteur')

    const response = await GET(cvRequest('?candidature=11'))

    expect(response.status).toBe(403)
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("échec de l’écriture d’audit : pas d’URL signée (fail-closed)", async () => {
    auditCandidatureCreate.mockRejectedValueOnce(new Error('audit indisponible'))

    await expect(GET(cvRequest('?candidature=11'))).rejects.toThrow('audit indisponible')
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).toHaveBeenCalled()
  })
})

describe('GET /api/files/cv — paramètres mutuellement exclusifs', () => {
  it('refuse les DEUX paramètres présents (400), sans requête base', async () => {
    login(42, 'candidat')

    const response = await GET(cvRequest('?candidatId=5&candidature=11'))

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("refuse l'absence de paramètre (400), sans requête base", async () => {
    login(42, 'candidat')

    const response = await GET(cvRequest(''))

    expect(response.status).toBe(400)
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it('refuse ?candidature=abc (400), sans requête base', async () => {
    login(42, 'candidat')

    for (const query of ['?candidature=abc', '?candidature=-1', '?candidature=0']) {
      expect((await GET(cvRequest(query))).status).toBe(400)
    }
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})
