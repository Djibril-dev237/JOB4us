import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logCvAccess } from '@/lib/audit'
import { ACTION_AUDIT_CONSULTATION } from '@/lib/candidature-audit'
import type { Role } from '@/lib/definitions'
import { signDownloadUrl } from '@/lib/storage'

import * as route from './route'

// ─── Tests de SÉCURITÉ de GET /api/files/cv (V3-J, vague transverse) ────────
// Mêmes exigences que candidatures.securite.test.ts : PRouver les refus déjà
// verrouillés dans route.ts, sans rien y changer. Cas V3-J :
//   cas 9  mode `?candidature=` : UNE ligne `consultation` par accès
//          recruteur, acteur = son userId, cible = la ligne, écrite
//          APRÈS logCvAccess et AVANT la signature — échec d'une des deux
//          traces ⇒ aucune URL signée (fail-closed) ;
//   cas 10 AUCUNE écriture au mauvais endroit : le propriétaire candidat lit
//          SANS trace, et le mode `?candidatId=` n'écrit JAMAIS d'audit ;
//   cas 11 scoping : une ligne d'autrui ne diffuse rien et n'écrit rien ;
//          l'id inexistant partage le 404 « ligne sans pièce jointe » ;
//   cas 12 la route ne lit QUE l'URL : aucun export POST/PUT, et un corps ou
//          des en-têtes forgés ne changent ni le verdict ni les requêtes base.
// Le module d'audit tourne pour de vrai sur le prisma simulé (payload lu
// tel qu'écrit) ; seuls auth, prisma, logCvAccess et signDownloadUrl sont
// mockés (downloadMeta reste réel, comme dans route.test.ts).
// ---------------------------------------------------------------------------

// ─── Doubles (typés sur ce que la route lit réellement) ─────────────────────

/** Session Auth.js : la route ne lit QUE `user.id` (nombre) et `user.role`. */
interface SessionBrute {
  user?: { id?: unknown; role?: unknown }
  expires?: string
}

/** Colonnes lues sur `Candidat` (select id, userId, cvPath). */
interface CandidatLu {
  id: number
  userId: number
  cvPath: string | null
}

/** Colonnes lues sur `Candidature` (lecture UNIQUE du mode `?candidature=`). */
interface CandidatureLu {
  id: number
  cvPath: string | null
  candidat: { id: number; userId: number }
  offre: { entreprise: { userId: number } }
}

interface TraceAudit {
  candidatureId: number
  acteurId: number
  action: string
  ancienStatut: string | null
  nouveauStatut: string | null
}

const { authMock, auditCandidatureCreate, candidatFindUnique, candidatureFindFirst, candidatureFindUnique } =
  vi.hoisted(() => ({
    authMock: vi.fn<() => Promise<SessionBrute | null>>(),
    auditCandidatureCreate: vi.fn<(args: { data: TraceAudit }) => Promise<TraceAudit>>(),
    candidatFindUnique: vi.fn<(args: unknown) => Promise<CandidatLu | null>>(),
    candidatureFindFirst: vi.fn<(args: unknown) => Promise<{ id: number } | null>>(),
    candidatureFindUnique: vi.fn<
      (args: { where: { id: number } }) => Promise<CandidatureLu | null>
    >(),
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

// Journal d'accès mocké (fail-closed testable) ; l'audit de candidature
// n'est PAS mocké : le payload écrit est lu tel quel.
vi.mock('@/lib/audit')
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return { ...actual, signDownloadUrl: vi.fn() }
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SIGNED_URL = 'https://r2.example/bucket/cvs/uuid.pdf?X-Amz-Signature=abc'

/** Profil CV de l'utilisateur 42 (clé de PROFIL). */
const PROFIL: CandidatLu = { id: 5, userId: 42, cvPath: 'cvs/aaaa-bbbb.pdf' }

/**
 * SNAPSHOT rattaché à la candidature — VOLONTAIREMENT distinct de
 * `PROFIL.cvPath` : toute confusion de clé échoue une assertion.
 */
const SNAPSHOT = 'candidatures/1111-2222-3333.pdf'

/** Ligne 11 : candidat 5 (userId 42), offre du recruteur userId 3. */
const CANDIDATURE: CandidatureLu = {
  id: 11,
  cvPath: SNAPSHOT,
  candidat: { id: 5, userId: 42 },
  offre: { entreprise: { userId: 3 } },
}

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

function cvRequest(query = '?candidature=11'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/files/cv${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(signDownloadUrl).mockResolvedValue(SIGNED_URL)
  vi.mocked(logCvAccess).mockResolvedValue(undefined)
  auditCandidatureCreate.mockImplementation(async (args) => args.data)
  candidatFindUnique.mockResolvedValue(PROFIL)
  // La lecture doit respecter l'`id` demandé : un id inexistant → null (404).
  candidatureFindUnique.mockImplementation(async (args) =>
    args.where.id === CANDIDATURE.id ? CANDIDATURE : null,
  )
  candidatureFindFirst.mockResolvedValue({ id: 11 })
})

// ─── CAS 9 — la `consultation` est écrite PAR l'acteur, AVANT la diffusion ──

describe('cas 9 — audit `consultation` fidèle (recruteur uniquement en M10)', () => {
  it("recruteur : UNE ligne `consultation` (acteur = son userId, cible = la ligne), APRÈS logCvAccess, AVANT signDownloadUrl", async () => {
    login(3, 'recruteur')

    const response = await route.GET(cvRequest())

    expect(response.status).toBe(302)
    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE.id,
        // Acteur = le compte recruteur connecté, JAMAIS le candidat (5).
        acteurId: 3,
        action: ACTION_AUDIT_CONSULTATION,
        ancienStatut: null,
        nouveauStatut: null,
      },
    })
    // Fail-closed complet : journal d'accès → audit → signature.
    const ordreJournal = vi.mocked(logCvAccess).mock.invocationCallOrder[0] ?? 0
    const ordreAudit = auditCandidatureCreate.mock.invocationCallOrder[0] ?? 0
    const ordreSignature = vi.mocked(signDownloadUrl).mock.invocationCallOrder[0] ?? 0
    expect(ordreAudit).toBeGreaterThan(ordreJournal)
    expect(ordreSignature).toBeGreaterThan(ordreAudit)
  })

  it("admin : refus 403, aucune trace et aucune URL signée", async () => {
    login(1, 'admin')

    const response = await route.GET(cvRequest())

    expect(response.status).toBe(403)
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("échec de l'audit : AUCUNE URL signée, l'exception se propage (même régime que logCvAccess)", async () => {
    login(3, 'recruteur')
    auditCandidatureCreate.mockImplementation(async () => {
      throw new Error('audit indisponible')
    })

    await expect(route.GET(cvRequest())).rejects.toThrow('audit indisponible')

    expect(signDownloadUrl).not.toHaveBeenCalled()
    // Le journal d'accès a été écrit AVANT l'audit : les deux traces restent
    // ordonnées, et c'est l'échec de la SECONDE qui bloque la diffusion.
    expect(logCvAccess).toHaveBeenCalledTimes(1)
  })

  it("échec du journal d'accès : AUCUNE ligne `consultation` ni URL signée (ordre des deux traces)", async () => {
    login(3, 'recruteur')
    vi.mocked(logCvAccess).mockImplementation(async () => {
      throw new Error('journal indisponible')
    })

    await expect(route.GET(cvRequest())).rejects.toThrow('journal indisponible')

    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})

// ─── CAS 10 — aucune écriture au mauvais endroit ────────────────────────────

describe("cas 10 - pas d'audit hors du couple (recruteur, ?candidature=)", () => {
  it("propriétaire candidat lisant sa propre pièce jointe : 302 SANS journal d'accès et SANS `consultation`", async () => {
    login(42, 'candidat')

    const response = await route.GET(cvRequest())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    // Lecture UNIQUE et à liste blanche sur la ligne (aucune colonne du
    // profil, aucun aller-retour de contrôle).
    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: 11 },
      select: SELECT_CANDIDATURE,
    })
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("mode ?candidatId= recruteur : 302 + journal d'accès mais AUCUNE ligne `consultation`", async () => {
    login(3, 'recruteur')
    candidatureFindFirst.mockResolvedValue({ id: 11 })

    const response = await route.GET(cvRequest('?candidatId=5'))

    expect(response.status).toBe(302)
    expect(logCvAccess).toHaveBeenCalledWith(3, 5)
    // Le profil n'est PAS un événement de candidature (colonne non nullable).
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
  })

  it("mode ?candidatId= admin : refus 403, aucune écriture", async () => {
    login(1, 'admin')

    const response = await route.GET(cvRequest('?candidatId=5'))

    expect(response.status).toBe(403)
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("mode ?candidatId= candidat sur son propre profil : AUCUNE écriture", async () => {
    login(42, 'candidat')

    const response = await route.GET(cvRequest('?candidatId=5'))

    expect(response.status).toBe(302)
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })
})

// ─── CAS 11 — scoping : ligne d'autrui ≠ ligne absente, et rien ne fuit ────

describe('cas 11 — scoping de la pièce jointe de candidature', () => {
  it("recruteur d'une autre entreprise sur ?candidature= d'autrui : REFUS, AUCUNE écriture ni URL", async () => {
    login(9, 'recruteur')

    const response = await route.GET(cvRequest())

    // Le code source répond 403 — DÉROGATION DOCUMENTÉE et arbitrée dans
    // route.ts (« 403 = refus de la matrice », oracle résiduel assumé derrière
    // une session authentifiée). La spécification V3-J annonçait 404 : le
    // verrou testé ici est le REFUS SANS diffusion ni écriture (voir rapport).
    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("?candidature=999999 : 404, aucune écriture — INDISCERNABLE de la ligne sans pièce jointe (mêmes code ET message)", async () => {
    login(42, 'candidat')

    const absente = await route.GET(cvRequest('?candidature=999999'))
    candidatureFindUnique.mockResolvedValue({ ...CANDIDATURE, cvPath: null })
    const sansPiece = await route.GET(cvRequest('?candidature=11'))

    expect(absente.status).toBe(404)
    expect(sansPiece.status).toBe(404)
    expect(await absente.json()).toEqual(await sansPiece.json())
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("404 ligne absente ≡ 404 ligne `cvPath` null ≡ 404 du mode ?candidatId= (aucune fuite d'existence)", async () => {
    login(42, 'candidat')

    const candidatureAbsente = await route.GET(cvRequest('?candidature=999999'))
    candidatureFindUnique.mockResolvedValue({ ...CANDIDATURE, cvPath: null })
    const candidatureSansPiece = await route.GET(cvRequest())
    candidatFindUnique.mockResolvedValue({ ...PROFIL, cvPath: null })
    const profilSansCv = await route.GET(cvRequest('?candidatId=5'))

    expect(candidatureAbsente.status).toBe(404)
    expect(candidatureSansPiece.status).toBe(404)
    expect(profilSansCv.status).toBe(404)
    const corps = await candidatureAbsente.json()
    expect(await candidatureSansPiece.json()).toEqual(corps)
    expect(await profilSansCv.json()).toEqual(corps)
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })

  it("candidat d'un autre compte : 403 même avec `userId`/`role` FORGÉS dans la query string", async () => {
    login(7, 'candidat')

    // `candidatId` est volontairement ABSENT : les deux paramètres seraient
    // refusés en 400 (exclusivité) — ici on sonde l'identité forgée seule.
    const response = await route.GET(cvRequest('?candidature=11&userId=42&role=admin'))

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it("recruteur sans offre liée sur ?candidatId= : 403, sans journal ni signature (la condition est lue en base)", async () => {
    login(3, 'recruteur')
    candidatureFindFirst.mockResolvedValue(null)

    const response = await route.GET(cvRequest('?candidatId=5'))

    expect(response.status).toBe(403)
    expect(candidatureFindFirst).toHaveBeenCalledWith({
      where: { candidatId: PROFIL.id, offre: { entreprise: { userId: 3 } } },
      select: { id: true },
    })
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })
})

// ─── CAS 12 — la route ne lit QUE l'URL ─────────────────────────────────────

describe('cas 12 — aucun vecteur hors URL (méthode, corps, en-têtes)', () => {
  it("le module n'expose QUE GET : aucun handler POST/PUT/PATCH/DELETE n'existe (405 côté Next)", () => {
    expect(Object.keys(route).sort()).toEqual(['GET'])
    expect(typeof route.GET).toBe('function')
  })

  it("un corps JSON forgé + en-têtes hostiles ne changent NI le verdict NI les requêtes base", async () => {
    login(42, 'candidat')

    const propre = await route.GET(cvRequest())
    const hostile = await route.GET(
      new NextRequest('http://localhost:3000/api/files/cv?candidature=11', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': '1',
          'x-role': 'admin',
          cookie: 'session=forged',
        },
        body: JSON.stringify({
          role: 'admin',
          userId: 1,
          candidatureId: 11,
          cvPath: 'cvs/vole.pdf',
          action: 'consultation',
        }),
      }),
    )

    expect(hostile.status).toBe(propre.status)
    expect(hostile.headers.get('location')).toBe(propre.headers.get('location'))
    expect(candidatureFindUnique).toHaveBeenCalledTimes(2)
    expect(candidatureFindUnique.mock.calls[1]).toEqual(candidatureFindUnique.mock.calls[0])
    // L'identité vient UNIQUEMENT du cookie de session : la requête forgee
    // n'a provoqué ni écriture d'audit ni journal supplémentaire.
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it('même corps forgé sur une ligne d autrui : le verdict de refus est INCHANGÉ', async () => {
    login(9, 'recruteur')

    const response = await route.GET(
      new NextRequest('http://localhost:3000/api/files/cv?candidature=11', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-role': 'admin' },
        body: JSON.stringify({ role: 'admin', entrepriseUserId: 3 }),
      }),
    )

    expect(response.status).toBe(403)
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })
})

// ─── Transverse — contrôles posés AVANT toute lecture de base ───────────────

describe('transverse — 401 et 400 sans aucune requête base', () => {
  it("401 avant tout : session absente, `user.id` absent, `id` non nombre ou `role` absent", async () => {
    for (const session of [
      null,
      { user: { role: 'admin' } },
      { user: { id: '42', role: 'admin' } },
      { user: { id: 42 } },
    ]) {
      authMock.mockResolvedValue(session)
      expect((await route.GET(cvRequest())).status).toBe(401)
      expect((await route.GET(cvRequest('?candidatId=5'))).status).toBe(401)
    }

    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it("401 prime sur le 400 : un visiteur ne sonde même pas la validité des paramètres", async () => {
    authMock.mockResolvedValue(null)

    expect((await route.GET(cvRequest('?candidature=abc'))).status).toBe(401)
    expect((await route.GET(cvRequest('?candidatId=&candidature='))).status).toBe(401)
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it("400 sans requête base : ids non strictement positifs ('01', '1e3', '+5', ' 5', décimal, zéro)", async () => {
    login(1, 'admin')

    const queries = [
      '?candidatId=01',
      '?candidatId=1e3',
      '?candidatId=%2B5',
      '?candidatId=%205',
      '?candidatId=5.5',
      '?candidatId=0',
      '?candidature=01',
      '?candidature=1e3',
      '?candidature=%2B11',
      '?candidature=11%20',
    ]
    for (const query of queries) {
      expect((await route.GET(cvRequest(query))).status, query).toBe(400)
    }

    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
    expect(logCvAccess).not.toHaveBeenCalled()
  })

  it("les DEUX paramètres ensemble (même avec un corps forgé) : 400, sans requête base", async () => {
    login(1, 'admin')

    const response = await route.GET(
      new NextRequest('http://localhost:3000/api/files/cv?candidatId=5&candidature=11', {
        method: 'POST',
        body: JSON.stringify({ role: 'admin' }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(400)
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(signDownloadUrl).not.toHaveBeenCalled()
  })
})
