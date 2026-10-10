import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { annulerSnapshotCv, preparerSnapshotCv } from '@/lib/candidature-cv'
import { messageErreurCandidature, messageMajCandidature } from '@/lib/candidatures-labels'
import { verifyRole } from '@/lib/dal'
import {
  candidatureEnvoyee,
  candidatureRetiree,
  statutChange,
} from '@/lib/evenements-candidature'
import type { OffreDetail } from '@/lib/offres-public'
import { lireOffrePublique } from '@/lib/offres-public'
import {
  CANDIDATURES_MAX_PAR_COMPTE,
  CANDIDATURES_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'
import { notFound, redirect } from 'next/navigation'

import {
  changerStatutCandidature,
  marquerConsultee,
  postulerOffre,
  retirerCandidature,
} from './candidatures'

// ─── Tests des actions serveur des candidatures (M7) ─────────────────────────
// Critères verrouillés (calque de offres.test.ts) :
// 1. ordre imposé rôle → ownership → transition (une ligne d'autrui meurt en
//    404 AVANT tout contrôle de formulaire) ;
// 2. doctrine 404 : inexistante / d'autrui / id mal formé = mêmes symptômes,
//    JAMAIS un `?erreur=` distinct ;
// 3. compare-and-set : la source (périmètre + statut) voyage DANS le `where`
//    d'`updateMany`, jamais une lecture puis une écriture pour le verdict ;
// 4. anti mass-assignment : `statut`, `offreId`, `candidatId`, `cvPath` ne
//    sortent JAMAIS du payload ;
// 5. seau M7 consommé UNIQUEMENT après une candidature réellement créée ;
// 6. l’écriture d’audit (`AuditCandidature`) est ATOMIQUE avec la mutation
//    (MÊME `$transaction`, seulement si le CAS réussit), acteur =
//    `session.userId`, jamais branchée sur les hooks M8/M9.
// Aucune donnée réelle : prisma, dal, offres-public, candidature-cv,
// rate-limit, les hooks d'événements et next/navigation sont mockés
// (redirect/notFound lèvent pour que le flux s'arrête comme en prod).
// Le module d’audit (src/lib/candidature-audit.ts) n’est PAS mocké : il
// tourne pour de vrai sur le prisma simulé, donc les assertions portent sur
// le payload RÉELLEMENT passé à `auditCandidature.create`.
// ---------------------------------------------------------------------------

const {
  auditCandidatureCreate,
  candidatureCreate,
  candidatureFindUnique,
  candidatureFindFirst,
  candidatureUpdateMany,
  candidatFindUnique,
  offreFindUnique,
  transaction,
} = vi.hoisted(() => ({
  auditCandidatureCreate: vi.fn(),
  candidatureCreate: vi.fn(),
  candidatureFindUnique: vi.fn(),
  candidatureFindFirst: vi.fn(),
  candidatureUpdateMany: vi.fn(),
  candidatFindUnique: vi.fn(),
  offreFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidature: {
      create: candidatureCreate,
      findUnique: candidatureFindUnique,
      findFirst: candidatureFindFirst,
      updateMany: candidatureUpdateMany,
    },
    candidat: { findUnique: candidatFindUnique },
    offre: { findUnique: offreFindUnique },
    auditCandidature: { create: auditCandidatureCreate },
    $transaction: transaction,
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

vi.mock('@/lib/offres-public', () => ({
  lireOffrePublique: vi.fn(),
}))

vi.mock('@/lib/candidature-cv', () => ({
  preparerSnapshotCv: vi.fn(),
  annulerSnapshotCv: vi.fn(),
}))

// Le seau M7 est mocké (contrôle de sa clé, de son plafond et de sa fenêtre)
// MAIS les constantes de politique sont celles du module réel : un écart de
// fenêtre ou de plafond casserait le contrat sans casser les assertions.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...original, checkRateLimit: vi.fn(), recordAttempt: vi.fn() }
})

// Spies qui EXÉCUTENT le hook réel (no-op) : les assertions d'émission des
// actions restent possibles, et le test « les 3 s'exécutent sans erreur »
// porte sur la VRAIE implémentation, pas sur un stub vide.
vi.mock('@/lib/evenements-candidature', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/evenements-candidature')>()
  return {
    candidatureEnvoyee: vi.fn(original.candidatureEnvoyee),
    candidatureRetiree: vi.fn(original.candidatureRetiree),
    statutChange: vi.fn(original.statutChange),
  }
})

// redirect() et notFound() lèvent en production : les mocks font pareil, sinon
// l'action continuerait après son verdict et les assertions de « pas d'écriture
// après refus » seraient fausses.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Client transmis au callback de `$transaction` : les MÊMES spies servent
 * DANS la transaction, ce qui prouve que l’action ne passe que par le tx pour
 * créer, muter et journaliser (audit inclus).
 */
const TX = {
  candidature: { create: candidatureCreate, updateMany: candidatureUpdateMany },
  auditCandidature: { create: auditCandidatureCreate },
}

const USER_ID = 42
const CANDIDAT_ID = 7
const OFFRE_ID = 42
const CANDIDATURE_ID = 900
const SLUG = 'developpeur-back-end-42'
const CLE_SNAPSHOT = 'candidatures/abc-123.pdf'

/** Le module est mocké : l'action ne lit de l'offre que son `id`. */
const OFFRE_VISIBLE = { id: OFFRE_ID } as unknown as OffreDetail

const CLE_SEAU = `candidatures:postulation:${USER_ID}`

const LETTRE = 'Je suis motivé pour ce poste.'

function formOf(entries: Record<string, string | File>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) formData.set(key, value)
  return formData
}

const FORM_POSTULATION: Record<string, string> = {
  slug: SLUG,
  lettreMotivation: LETTRE,
  sourceCv: 'profil',
}

const FORM_RETRAIT: Record<string, string> = { id: String(CANDIDATURE_ID) }

const FORM_TRANSITION: Record<string, string> = {
  id: String(CANDIDATURE_ID),
  vers: 'consultee',
}

/** Premier `data` passé à `prisma.candidature.create`. */
function dataCreation(): Record<string, unknown> | undefined {
  return (candidatureCreate.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined)?.data
}

/** Premier `where` passé à `prisma.candidature.updateMany`. */
function whereUpdateMany(): Record<string, unknown> | undefined {
  return (candidatureUpdateMany.mock.calls[0]?.[0] as
    | { where: Record<string, unknown> }
    | undefined)?.where
}

/** Toute action de la Vague M7 réussit (ou échoue) TOUJOURS par une redirection. */
async function attendRedirection(action: Promise<unknown>, url: string): Promise<void> {
  await expect(action).rejects.toThrow(`REDIRECT:${url}`)
  expect(redirect).toHaveBeenCalledWith(url)
  expect(notFound).not.toHaveBeenCalled()
}

/** Ligne étrangère / inexistante / id mal formé : 404, et JAMAIS de redirection. */
async function attend404(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toThrow('NOT_FOUND')
  expect(notFound).toHaveBeenCalledTimes(1)
  expect(redirect).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
  vi.mocked(lireOffrePublique).mockResolvedValue(OFFRE_VISIBLE)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 })
  vi.mocked(preparerSnapshotCv).mockResolvedValue({ ok: true, cle: CLE_SNAPSHOT })

  candidatFindUnique.mockResolvedValue({ id: CANDIDAT_ID })
  offreFindUnique.mockResolvedValue({ id: OFFRE_ID })
  candidatureCreate.mockResolvedValue({ id: CANDIDATURE_ID })
  // `statut` sert d’ancien statut à l’audit `retrait` (lecture de contrôle).
  candidatureFindUnique.mockResolvedValue({
    offreId: OFFRE_ID,
    candidatId: CANDIDAT_ID,
    statut: 'envoyee',
  })
  candidatureFindFirst.mockResolvedValue({
    statut: 'envoyee',
    offreId: OFFRE_ID,
    candidatId: CANDIDAT_ID,
  })
  candidatureUpdateMany.mockResolvedValue({ count: 1 })
  transaction.mockImplementation(async (fn: (tx: typeof TX) => Promise<unknown>) => fn(TX))
})

// ─── postulerOffre ───────────────────────────────────────────────────────────

describe('postulerOffre', () => {
  it('crée la candidature SANS statut (défaut envoyee) et redirige ?maj=envoyee', async () => {
    await attendRedirection(postulerOffre(formOf(FORM_POSTULATION)), `/offres/${SLUG}/postuler?maj=envoyee`)

    // Liste blanche stricte : 4 clés, pas une de plus.
    expect(dataCreation()).toEqual({
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
      lettreMotivation: LETTRE,
      cvPath: CLE_SNAPSHOT,
    })
    expect(dataCreation()).not.toHaveProperty('statut')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(preparerSnapshotCv).toHaveBeenCalledWith({
      candidatId: CANDIDAT_ID,
      source: 'profil',
    })

    // Seau M7 : contrôlé avant l'écriture, consommé APRÈS, fenêtre 1 h.
    expect(checkRateLimit).toHaveBeenCalledWith(
      CLE_SEAU,
      CANDIDATURES_MAX_PAR_COMPTE,
      CANDIDATURES_WINDOW_MS,
    )
    expect(recordAttempt).toHaveBeenCalledTimes(1)
    expect(recordAttempt).toHaveBeenCalledWith(CLE_SEAU, CANDIDATURES_WINDOW_MS)
    expect(vi.mocked(recordAttempt).mock.invocationCallOrder[0]).toBeGreaterThan(
      candidatureCreate.mock.invocationCallOrder[0] ?? 0,
    )
    expect(candidatureEnvoyee).toHaveBeenCalledWith({
      candidatureId: CANDIDATURE_ID,
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    })
  })

  it("écrit lettreMotivation null quand la lettre est vide ('' → undefined → null)", async () => {
    await attendRedirection(
      postulerOffre(formOf({ ...FORM_POSTULATION, lettreMotivation: '' })),
      `/offres/${SLUG}/postuler?maj=envoyee`,
    )

    expect(dataCreation()?.lettreMotivation).toBeNull()
  })

  it('répond ?erreur=doublon sur P2002 : annulation du snapshot, AUCUN seau', async () => {
    candidatureCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`offre_id`,`candidat_id`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      ),
    )

    await attendRedirection(
      postulerOffre(formOf(FORM_POSTULATION)),
      `/offres/${SLUG}/postuler?erreur=doublon`,
    )

    expect(annulerSnapshotCv).toHaveBeenCalledWith(CLE_SNAPSHOT)
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(candidatureEnvoyee).not.toHaveBeenCalled()
    // La création a échoué AVANT l’audit : AUCUNE ligne d’audit.
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it('écrit la ligne d’audit `creation` (acteur = USER_ID, jamais CANDIDAT_ID) APRÈS le create et AVANT recordAttempt', async () => {
    await attendRedirection(
      postulerOffre(formOf(FORM_POSTULATION)),
      `/offres/${SLUG}/postuler?maj=envoyee`,
    )

    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: USER_ID,
        action: 'creation',
        ancienStatut: null,
        nouveauStatut: 'envoyee',
      },
    })
    // Même client transactionnel que le create (atomicité fail-closed).
    expect(transaction).toHaveBeenCalledTimes(1)
    // Ordre imposé : create → audit → consommation du seau.
    const ordreCreate = candidatureCreate.mock.invocationCallOrder[0] ?? 0
    const ordreAudit = auditCandidatureCreate.mock.invocationCallOrder[0] ?? 0
    const ordreSeau = vi.mocked(recordAttempt).mock.invocationCallOrder[0] ?? 0
    expect(ordreAudit).toBeGreaterThan(ordreCreate)
    expect(ordreSeau).toBeGreaterThan(ordreAudit)
  })

  it("échec d’audit : rollback complet (snapshot annulé), re-throw, AUCUN redirect", async () => {
    auditCandidatureCreate.mockRejectedValueOnce(new Error('AUDIT_DOWN'))

    await expect(postulerOffre(formOf(FORM_POSTULATION))).rejects.toThrow('AUDIT_DOWN')

    expect(annulerSnapshotCv).toHaveBeenCalledWith(CLE_SNAPSHOT)
    expect(redirect).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(candidatureEnvoyee).not.toHaveBeenCalled()
  })

  it('relance une erreur inconnue APRÈS avoir annulé le snapshot (rollback best-effort)', async () => {
    candidatureCreate.mockRejectedValue(new Error('DB_DOWN'))

    await expect(postulerOffre(formOf(FORM_POSTULATION))).rejects.toThrow('DB_DOWN')

    expect(annulerSnapshotCv).toHaveBeenCalledWith(CLE_SNAPSHOT)
    expect(redirect).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('refuse un snapshot « profil-incomplet » avant toute écriture', async () => {
    vi.mocked(preparerSnapshotCv).mockResolvedValue({ ok: false, code: 'profil-incomplet' })

    await attendRedirection(
      postulerOffre(formOf(FORM_POSTULATION)),
      `/offres/${SLUG}/postuler?erreur=profil-incomplet`,
    )

    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(annulerSnapshotCv).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(candidatureEnvoyee).not.toHaveBeenCalled()
  })

  it('distingue une offre jadis publiée mais non visible (?erreur=offre-indisponible)', async () => {
    vi.mocked(lireOffrePublique).mockResolvedValue(null)
    offreFindUnique.mockResolvedValue({ statut: 'cloturee' })

    await attendRedirection(
      postulerOffre(formOf(FORM_POSTULATION)),
      `/candidat/candidatures?erreur=offre-indisponible`,
    )

    expect(offreFindUnique).toHaveBeenCalledWith({
      where: { slug: SLUG },
      select: { statut: true },
    })
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(preparerSnapshotCv).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
  })

  it('brouillon : MÊME 404 qu’une offre absente (aucun oracle d’existence, P2-1)', async () => {
    vi.mocked(lireOffrePublique).mockResolvedValue(null)
    offreFindUnique.mockResolvedValue({ statut: 'brouillon' })

    await attend404(postulerOffre(formOf(FORM_POSTULATION)))
    expect(redirect).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('slug forgé hors format M5 : MÊME 404, avant seau et lectures (P3-10)', async () => {
    const forgé = formOf(FORM_POSTULATION)
    forgé.set('slug', 'x?maj=envoyee')

    await attend404(postulerOffre(forgé))
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(lireOffrePublique).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
  })

  it('répond 404 (et jamais ?erreur=) pour une offre absente', async () => {
    vi.mocked(lireOffrePublique).mockResolvedValue(null)
    offreFindUnique.mockResolvedValue(null)

    await attend404(postulerOffre(formOf(FORM_POSTULATION)))
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('refuse au seau M7 épuisé AVANT toute lecture et toute écriture', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterMs: 3_600_000 })

    await attendRedirection(
      postulerOffre(formOf(FORM_POSTULATION)),
      `/offres/${SLUG}/postuler?erreur=trop-de-demandes`,
    )

    expect(checkRateLimit).toHaveBeenCalledWith(
      CLE_SEAU,
      CANDIDATURES_MAX_PAR_COMPTE,
      CANDIDATURES_WINDOW_MS,
    )
    expect(lireOffrePublique).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(preparerSnapshotCv).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('exige le rôle candidat EN PREMIER : aucune lecture, aucune écriture', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('STOP_ROLE'))

    await expect(postulerOffre(formOf(FORM_POSTULATION))).rejects.toThrow('STOP_ROLE')

    expect(verifyRole).toHaveBeenCalledWith('candidat')
    expect(lireOffrePublique).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("répond 404 si le compte n'a pas de ligne Candidat", async () => {
    candidatFindUnique.mockResolvedValue(null)

    await attend404(postulerOffre(formOf(FORM_POSTULATION)))
    expect(preparerSnapshotCv).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
  })

  it("refuse un payload Zod invalide par ?erreur=fichier-invalide, sans écriture", async () => {
    // `sourceCv: fichier` sans aucun fichier → échec de superRefine.
    await attendRedirection(
      postulerOffre(formOf({ slug: SLUG, sourceCv: 'fichier' })),
      `/offres/${SLUG}/postuler?erreur=fichier-invalide`,
    )

    expect(preparerSnapshotCv).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })
})

// ─── retirerCandidature ──────────────────────────────────────────────────────

describe('retirerCandidature', () => {
  it('retire via un CAS portant { id, candidatId, statut: { notIn: terminaux } }', async () => {
    await attendRedirection(
      retirerCandidature(formOf(FORM_RETRAIT)),
      '/candidat/candidatures?maj=retiree',
    )

    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: CANDIDATURE_ID },
      select: { offreId: true, candidatId: true, statut: true },
    })
    expect(candidatureUpdateMany).toHaveBeenCalledTimes(1)
    expect(whereUpdateMany()).toEqual({
      id: CANDIDATURE_ID,
      candidatId: CANDIDAT_ID,
      statut: { notIn: ['acceptee', 'refusee', 'retiree'] },
    })
    expect(candidatureUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'retiree' } }),
    )
    expect(candidatureRetiree).toHaveBeenCalledWith({
      candidatureId: CANDIDATURE_ID,
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    })
  })

  it("écrit l’audit `retrait` (même transaction) avec le statut LU en contrôle", async () => {
    candidatureFindUnique.mockResolvedValue({
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
      statut: 'consultee',
    })

    await attendRedirection(
      retirerCandidature(formOf(FORM_RETRAIT)),
      '/candidat/candidatures?maj=retiree',
    )

    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: USER_ID,
        action: 'retrait',
        ancienStatut: 'consultee',
        nouveauStatut: 'retiree',
      },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('compte à zéro (ligne déjà terminale, déjà retirée, double clic) : ?erreur=retrait', async () => {
    candidatureUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(
      retirerCandidature(formOf(FORM_RETRAIT)),
      '/candidat/candidatures?erreur=retrait',
    )

    expect(whereUpdateMany()).toMatchObject({
      statut: { notIn: ['acceptee', 'refusee', 'retiree'] },
    })
    expect(candidatureRetiree).not.toHaveBeenCalled()
    // CAS à zéro : aucune mutation, donc AUCUNE ligne d’audit.
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("répond 404 pour une candidature d'un AUTRE candidat, sans écrire", async () => {
    candidatureFindUnique.mockResolvedValue({ offreId: OFFRE_ID, candidatId: 999 })

    await attend404(retirerCandidature(formOf(FORM_RETRAIT)))
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(candidatureRetiree).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it('refuse un id absent ou mal formé par le MÊME 404 qu’une ligne absente', async () => {
    await attend404(retirerCandidature(formOf({ id: '42.5' })))
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
  })

  it('exige le rôle candidat EN PREMIER', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('STOP_ROLE'))

    await expect(retirerCandidature(formOf(FORM_RETRAIT))).rejects.toThrow('STOP_ROLE')

    expect(verifyRole).toHaveBeenCalledWith('candidat')
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
  })
})

// ─── changerStatutCandidature ────────────────────────────────────────────────

describe('changerStatutCandidature', () => {
  beforeEach(() => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
  })

  it('envoyee → consultee (recruteur) : lecture avec jointure puis CAS idem', async () => {
    await attendRedirection(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
      '/recruteur/candidatures?maj=statut',
    )

    expect(candidatureFindFirst).toHaveBeenCalledWith({
      where: { id: CANDIDATURE_ID, offre: { entreprise: { userId: USER_ID } } },
      select: { statut: true, offreId: true, candidatId: true },
    })
    expect(candidatureFindFirst).toHaveBeenCalledTimes(1)
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    // Le périmètre EST dans le `where` du CAS, avec le statut source.
    expect(candidatureUpdateMany).toHaveBeenCalledWith({
      where: {
        id: CANDIDATURE_ID,
        statut: 'envoyee',
        offre: { entreprise: { userId: USER_ID } },
      },
      data: { statut: 'consultee' },
    })
    expect(statutChange).toHaveBeenCalledWith({
      candidatureId: CANDIDATURE_ID,
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
      acteurId: USER_ID,
    })
    // Audit `transition` : MÊME transaction que le CAS, acteur = session.
    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: USER_ID,
        action: 'transition',
        ancienStatut: 'envoyee',
        nouveauStatut: 'consultee',
      },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    // `?maj=statut` n'a AUCUN message (fail-closed : le badge à jour relu par
    // la page est le feedback) — une clé porteuse de texte reste contrôlée.
    expect(messageMajCandidature('statut')).toBeNull()
    expect(messageMajCandidature('envoyee')).toBe('Candidature envoyée.')
  })

  it('refuse une transition interdite (consultee → entretien) : ?erreur=transition', async () => {
    candidatureFindFirst.mockResolvedValue({
      statut: 'consultee',
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    })

    await attendRedirection(
      changerStatutCandidature(formOf({ ...FORM_TRANSITION, vers: 'entretien' })),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(statutChange).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    // La clé du refus a bien un libellé contrôlé (source unique, fail-closed).
    expect(messageErreurCandidature('transition')).toBe(
      "Ce changement de statut n'est pas autorisé.",
    )
  })

  it("répond 404 pour la candidature d'un AUTRE recruteur, sans écrire", async () => {
    candidatureFindFirst.mockResolvedValue(null)

    await attend404(changerStatutCandidature(formOf(FORM_TRANSITION)))
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(statutChange).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it('refuse une cible hors des 7 statuts par le MÊME refus ?erreur=transition', async () => {
    await attendRedirection(
      changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), vers: 'vue' })),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it('CAS à zéro (double clic, écriture concurrente) : ?erreur=transition', async () => {
    candidatureUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(whereUpdateMany()).toMatchObject({ statut: 'envoyee' })
    expect(statutChange).not.toHaveBeenCalled()
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("l'admin n'a aucun périmètre (findUnique sans jointure) mais reste soumis à la matrice", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'admin' })
    candidatureFindUnique.mockResolvedValue({
      statut: 'acceptee',
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    })

    // Ligne d'un autre recruteur : l'admin lit globalement, la transition
    // reste soumise à la matrice (admin peut retirer une acceptée).
    await attendRedirection(
      changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), vers: 'retiree' })),
      '/recruteur/candidatures?maj=statut',
    )

    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: CANDIDATURE_ID },
      select: { statut: true, offreId: true, candidatId: true },
    })
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    // Aucune jointure d'ownership dans le CAS d'un admin.
    expect(whereUpdateMany()).toEqual({ id: CANDIDATURE_ID, statut: 'acceptee' })
    // Audit : ancien = statut LU en contrôle, nouveau = cible du formulaire.
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: USER_ID,
        action: 'transition',
        ancienStatut: 'acceptee',
        nouveauStatut: 'retiree',
      },
    })
  })

  it('exige recruteur OU admin EN PREMIER', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('STOP_ROLE'))

    await expect(changerStatutCandidature(formOf(FORM_TRANSITION))).rejects.toThrow('STOP_ROLE')

    expect(verifyRole).toHaveBeenCalledWith('recruteur', 'admin')
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
  })
})

// ─── marquerConsultee ────────────────────────────────────────────────────────

describe('marquerConsultee', () => {
  beforeEach(() => {
    // Rôle appelant par défaut du bloc : un recruteur (le périmètre du CAS
    // en dépend — l'appel sans session est testé plus bas).
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
  })

  it('exige le rôle recruteur/admin : aucune écriture sans autorisation (P1-1)', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('STOP_ROLE'))

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(verifyRole).toHaveBeenCalledWith('recruteur', 'admin')
    // Garde d'autorisation : POST direct non authentifié → aucune écriture.
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(statutChange).not.toHaveBeenCalled()
    // L’audit ne s’écrit même pas sans session : pas de mutation, pas de trace.
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it('passe envoyee → consultee par un CAS exact SCOPE au compte recruteur', async () => {
    await marquerConsultee(CANDIDATURE_ID)

    expect(candidatureUpdateMany).toHaveBeenCalledTimes(1)
    expect(candidatureUpdateMany).toHaveBeenCalledWith({
      where: {
        id: CANDIDATURE_ID,
        statut: 'envoyee',
        offre: { entreprise: { userId: USER_ID } },
      },
      data: { statut: 'consultee' },
    })
    expect(statutChange).not.toHaveBeenCalled()
    // Audit `transition` automatique : acteur = le compte de la session.
    expect(auditCandidatureCreate).toHaveBeenCalledTimes(1)
    expect(auditCandidatureCreate).toHaveBeenCalledWith({
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: USER_ID,
        action: 'transition',
        ancienStatut: 'envoyee',
        nouveauStatut: 'consultee',
      },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('admin : périmètre global (lecture/transition admin sans jointure)', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    await marquerConsultee(CANDIDATURE_ID)

    expect(candidatureUpdateMany).toHaveBeenCalledWith({
      where: { id: CANDIDATURE_ID, statut: 'envoyee' },
      data: { statut: 'consultee' },
    })
  })

  it('best-effort : une exception base ne se propage JAMAIS (page jamais en erreur)', async () => {
    candidatureUpdateMany.mockRejectedValue(new Error('DB_DOWN'))

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()
  })

  it('count à zéro (ligne déjà consultée) : ignoré, sans effet secondaire', async () => {
    candidatureUpdateMany.mockResolvedValue({ count: 0 })

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()
    expect(statutChange).not.toHaveBeenCalled()
    // Pas de mutation → AUCUNE ligne d’audit (jamais de trace orpheline).
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
  })

  it("échec d’audit : best-effort ATOMIQUE conservé (aucune exception propagée)", async () => {
    auditCandidatureCreate.mockRejectedValueOnce(new Error('AUDIT_DOWN'))

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()
    // Le rollback de la transaction est absorbé : la page ne casse jamais.
    expect(redirect).not.toHaveBeenCalled()
    expect(statutChange).not.toHaveBeenCalled()
  })
})

// ─── Hooks d'événements (M8 / M9) ────────────────────────────────────────────

describe("hooks d'événements", () => {
  it('les 3 hooks s’exécutent sans erreur (no-op verrouillé avant branchement M8/M9)', () => {
    const base = { candidatureId: 1, offreId: 2, candidatId: 3 }

    expect(() => candidatureEnvoyee(base)).not.toThrow()
    expect(() => candidatureRetiree(base)).not.toThrow()
    expect(() =>
      statutChange({
        ...base,
        ancienStatut: 'envoyee',
        nouveauStatut: 'consultee',
        acteurId: 9,
      }),
    ).not.toThrow()
  })

  it("aucun lien entre les hooks M8/M9 et l’audit : ils restent sans effet", () => {
    const base = { candidatureId: CANDIDATURE_ID, offreId: OFFRE_ID, candidatId: CANDIDAT_ID }

    candidatureEnvoyee(base)
    candidatureRetiree(base)
    statutChange({
      ...base,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
      acteurId: USER_ID,
    })

    // Un hook appelé n’écrit JAMAIS `AuditCandidature` : l’audit ne vit que
    // dans les actions et dans la route CV (src/lib/candidature-audit.ts).
    expect(auditCandidatureCreate).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
  })
})
