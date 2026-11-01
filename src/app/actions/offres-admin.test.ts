import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma } from '@prisma/client'

import { reauthAdminValide } from '@/lib/admin-reauth'
import { requireAdmin } from '@/lib/dal'
import { offreIndisponible } from '@/lib/evenements-offres'
import { consignerAudit } from '@/lib/journal-audit'
import { notFound, redirect } from 'next/navigation'

import { releverOffre, suspendreOffre } from './offres-admin'

// ─── Tests des actions admin T8/T9 (M10) ────────────────────────────────────
// Critères vérifiés ici :
// - ordre imposé : requireAdmin() en TOUT PREMIER, avant la moindre requête ;
// - doctrine 404 : id absent/invalide ET offre inexistante ou supprimée =
//   notFound() sans jamais un redirect ni un code distinct ;
// - compare-and-set : le statut source vit dans le `where` de l'updateMany,
//   count 0 → `?erreur=statut` (jamais `?maj=`) ;
// - motif fermé obligatoire : un motif absent ou forgé est refusé ;
// - audit et mutation dans la MÊME transaction, avec le motif et la note ;
// - anti mass-assignment : `statut`, `entrepriseId`, `deletedAt` forgés
//   dans le FormData n'ont AUCUN effet.
// ---------------------------------------------------------------------------

interface ArgsFindFirst {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
}

interface ArgsUpdateMany {
  where?: Prisma.OffreWhereInput
  data?: Prisma.OffreUpdateManyMutationInput
}

interface Tx {
  offre: { updateMany: typeof offreUpdateMany }
}

const { offreFindFirst, offreUpdateMany, transaction } = vi.hoisted(() => ({
  offreFindFirst: vi.fn<(args: ArgsFindFirst) => Promise<unknown>>(),
  offreUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
  transaction: vi.fn<(callback: (tx: Tx) => Promise<unknown>) => Promise<unknown>>(),
}))

vi.mock('@/lib/dal', () => ({
  requireAdmin: vi.fn(),
}))
vi.mock('@/lib/admin-reauth', () => ({
  reauthAdminValide: vi.fn(),
}))
vi.mock('@/lib/journal-audit', () => ({
  consignerAudit: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findFirst: offreFindFirst },
    $transaction: transaction,
  },
}))

// Spy exécutant les hooks réels (branchés M9) : « appelé une fois avec
// l'id » est vérifiable, et aucun verdict ne peut en dépendre.
vi.mock('@/lib/evenements-offres', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/evenements-offres')>()
  return {
    offrePubliee: vi.fn(original.offrePubliee),
    offreIndisponible: vi.fn(original.offreIndisponible),
  }
})

// Résolveurs M9 stubbés : les hooks réels ci-dessus leur délèguent en
// fire-and-forget — la matrice T8 seule décide des verdicts admin.
vi.mock('@/lib/notifications-evenements', () => ({
  notifierOffrePubliee: vi.fn(async () => undefined),
  notifierOffreIndisponible: vi.fn(async () => undefined),
}))

// Dans Next, redirect() et notFound() sont des exceptions de contrôle :
// les mocks lèvent aussi, sinon l'exécution continuerait après le verdict.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

/** Offre trouvée par la 1re lecture (le contenu importe peu, le where non). */
const OFFRE_VIVANTE = {
  titre: 'Developpeur back-end',
  statut: 'brouillon',
  entrepriseId: 3,
}

function formOf(entries: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [cle, valeur] of Object.entries(entries)) formData.set(cle, valeur)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue({ userId: 42, role: 'admin', sessionVersion: 0 })
  vi.mocked(reauthAdminValide).mockResolvedValue(true)
  offreFindFirst.mockResolvedValue(OFFRE_VIVANTE)
  offreUpdateMany.mockResolvedValue({ count: 1 })
  transaction.mockImplementation(async (callback) =>
    callback({ offre: { updateMany: offreUpdateMany } }),
  )
})

describe('suspendreOffre (T8)', () => {
  it('CAS `statut in` exact puis redirection ?maj=suspendue', async () => {
    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(requireAdmin).toHaveBeenCalledTimes(1)
    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 42, deletedAt: null })

    expect(offreUpdateMany).toHaveBeenCalledTimes(1)
    expect(offreUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: {
        id: 42,
        deletedAt: null,
        statut: { in: ['publiee', 'brouillon', 'cloturee'] },
      },
      data: { statut: 'suspendue' },
    })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=suspendue')
    expect(offreIndisponible).toHaveBeenCalledTimes(1)
    expect(offreIndisponible).toHaveBeenCalledWith({ offreId: 42 })
  })

  it('refus (count 0 : déjà suspendue ou course) → ?erreur=statut, jamais ?maj=', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=statut')
    expect(offreIndisponible).not.toHaveBeenCalled()
  })

  it('motif absent ou hors catalogue → ?erreur=forme, aucune lecture', async () => {
    await expect(suspendreOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=forme')
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()

    vi.mocked(redirect).mockClear()
    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'motif_invente' })),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=forme')
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })
})

describe('releverOffre (T9)', () => {
  it('CAS `statut: suspendue` → brouillon, puis redirection ?maj=levee', async () => {
    await expect(
      releverOffre(formOf({ id: '42', motif: 'autre' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(requireAdmin).toHaveBeenCalledTimes(1)
    expect(offreUpdateMany).toHaveBeenCalledTimes(1)
    expect(offreUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 42, deletedAt: null, statut: 'suspendue' },
      data: { statut: 'brouillon' },
    })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=levee')
    expect(offreIndisponible).not.toHaveBeenCalled()
  })

  it('refus (count 0 : offre relevée entre-temps) → ?erreur=statut', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      releverOffre(formOf({ id: '42', motif: 'autre' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=statut')
  })
})

describe('doctrine 404 (jamais de 403, jamais de redirect)', () => {
  it('id absent du FormData → notFound, avant toute requête', async () => {
    await expect(suspendreOffre(new FormData())).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalledTimes(1)
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('id non entier positif → notFound, aucune requête', async () => {
    for (const idForge of ['abc', '12.5', '-3', '0', '', '   ', '1e20']) {
      await expect(
        releverOffre(formOf({ id: idForge, motif: 'autre' })),
      ).rejects.toThrow('NEXT_NOT_FOUND')
    }

    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('offre inexistante ou supprimée → notFound ET PAS de redirect', async () => {
    offreFindFirst.mockResolvedValue(null)

    await expect(
      suspendreOffre(formOf({ id: '999', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 999, deletedAt: null })
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('sécurité payload (matrice seule)', () => {
  it('ignore statut/entrepriseId/deletedAt/slug forgés sur T8', async () => {
    await expect(
      suspendreOffre(
        formOf({
          id: '42',
          motif: 'qualite',
          statut: 'publiee',
          entrepriseId: '9',
          deletedAt: '2020-01-01',
          slug: 'offre-piratee',
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    const appel = offreUpdateMany.mock.calls[0]?.[0]
    expect(appel?.data).toEqual({ statut: 'suspendue' })
    for (const cleInterdite of ['entrepriseId', 'deletedAt', 'slug']) {
      expect(appel?.data).not.toHaveProperty(cleInterdite)
    }
    expect(appel?.where).toEqual({
      id: 42,
      deletedAt: null,
      statut: { in: ['publiee', 'brouillon', 'cloturee'] },
    })
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=suspendue')
  })

  it('ignore un statut forgé sur T9 (la cible reste brouillon)', async () => {
    await expect(
      releverOffre(
        formOf({
          id: '42',
          motif: 'autre',
          statut: 'publiee',
          entrepriseId: '9',
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(offreUpdateMany.mock.calls[0]?.[0].data).toEqual({ statut: 'brouillon' })
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=levee')
  })
})

describe('rôles, réauthentification et audit', () => {
  it('requireAdmin en premier : non-admin → 404 avant toute requête (T8)', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'))

    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(requireAdmin).toHaveBeenCalledTimes(1)
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('requireAdmin en premier : non-admin → 404 avant toute requête (T9)', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'))

    await expect(
      releverOffre(formOf({ id: '42', motif: 'autre' })),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(requireAdmin).toHaveBeenCalledTimes(1)
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('sans réauthentification : redirection vers /admin/reauth avant lecture', async () => {
    vi.mocked(reauthAdminValide).mockResolvedValueOnce(false)

    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/admin/reauth?retour=%2Fadmin%2Foffres')
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })

  it('audit et mutation dans la même transaction, avec motif et note', async () => {
    await expect(
      suspendreOffre(
        formOf({
          id: '42',
          motif: 'fraude',
          noteInterne: 'Compte lié à plusieurs plaintes.',
        }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(consignerAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: 42,
        action: 'suspension_offre',
        cibleType: 'offre',
        cibleId: 42,
        motif: 'fraude',
        commentaire: 'Compte lié à plusieurs plaintes.',
      }),
    )
    expect(vi.mocked(consignerAudit).mock.invocationCallOrder[0]).toBeGreaterThan(
      offreUpdateMany.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('une erreur d’audit annule la mutation (transaction rejetée)', async () => {
    vi.mocked(consignerAudit).mockRejectedValueOnce(new Error('audit indisponible'))

    await expect(
      suspendreOffre(formOf({ id: '42', motif: 'qualite' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=inconnue')
    expect(offreIndisponible).not.toHaveBeenCalled()
  })
})
