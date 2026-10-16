import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma } from '@prisma/client'

import { verifyRole } from '@/lib/dal'
import { offreIndisponible } from '@/lib/evenements-offres'
import { notFound, redirect } from 'next/navigation'

import { releverOffre, suspendreOffre } from './offres-admin'

// ─── Tests des actions admin T8/T9 (M6, Vague 2) ─────────────────────────────
// Critères vérifiés ici :
// - ordre imposé : verifyRole('admin') en TOUT PREMIER, avant la moindre
//   requête (rôle insuffisant → aucune offre lue, aucune écriture) ;
// - doctrine 404 : id absent/invalide ET offre inexistante ou supprimée =
//   notFound() sans jamais un redirect ni un code distinct ;
// - compare-and-set : le statut source vit dans le `where` de l'updateMany,
//   count 0 → `?erreur=statut` (jamais `?maj=`) ;
// - anti mass-assignment : `statut`, `entrepriseId`, `deletedAt` forges
//   dans le FormData n'ont AUCUN effet — le data vient de la matrice seule.
// ---------------------------------------------------------------------------

interface ArgsFindFirst {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
}

interface ArgsUpdateMany {
  where?: Prisma.OffreWhereInput
  data?: Prisma.OffreUpdateManyMutationInput
}

const { offreFindFirst, offreUpdateMany } = vi.hoisted(() => ({
  offreFindFirst: vi.fn<(args: ArgsFindFirst) => Promise<unknown>>(),
  offreUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findFirst: offreFindFirst, updateMany: offreUpdateMany },
  },
}))

// Spy exécutant le no-op réel (M9) : « appelé une fois avec l'id » est
// vérifiable, et aucun verdict ne peut en dépendre.
vi.mock('@/lib/evenements-offres', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/evenements-offres')>()
  return {
    offrePubliee: vi.fn(original.offrePubliee),
    offreIndisponible: vi.fn(original.offreIndisponible),
  }
})

// Dans Next, redirect() et notFound() sont des exceptions de contrôle :
// les mocks lèvent aussi, sinon l'exécution continuerait après le verdict
// (deux redirect sur le refus T8, écriture après un 404…) et le test ne
// pourrait plus dire quel chemin a été pris.
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
  vi.mocked(verifyRole).mockResolvedValue({ userId: 42, role: 'admin' })
  offreFindFirst.mockResolvedValue(OFFRE_VIVANTE)
  offreUpdateMany.mockResolvedValue({ count: 1 })
})

describe('suspendreOffre (T8)', () => {
  it('CAS `statut in` exact puis redirection ?maj=suspendue', async () => {
    await expect(suspendreOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(verifyRole).toHaveBeenCalledWith('admin')
    // Existence + suppression logique dans LA même lecture, sans périmètre
    // d'entreprise (l'admin voit toutes les offres).
    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 42, deletedAt: null })

    expect(offreUpdateMany).toHaveBeenCalledTimes(1)
    expect(offreUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 42, deletedAt: null, statut: { in: ['publiee', 'brouillon', 'cloturee'] } },
      data: { statut: 'suspendue' },
    })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=suspendue')
    // Événement M9 (no-op) : la suspension retire l'offre de la visibilité.
    expect(offreIndisponible).toHaveBeenCalledTimes(1)
    expect(offreIndisponible).toHaveBeenCalledWith({ offreId: 42 })
  })

  it('refus (count 0 : déjà suspendue ou course) → ?erreur=statut, jamais ?maj=', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await expect(suspendreOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?erreur=statut')
    // Aucune suspension → aucun événement.
    expect(offreIndisponible).not.toHaveBeenCalled()
  })
})

describe('releverOffre (T9)', () => {
  it('CAS `statut: suspendue` → brouillon, puis redirection ?maj=levee', async () => {
    await expect(releverOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(verifyRole).toHaveBeenCalledWith('admin')
    expect(offreUpdateMany).toHaveBeenCalledTimes(1)
    expect(offreUpdateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 42, deletedAt: null, statut: 'suspendue' },
      data: { statut: 'brouillon' },
    })
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=levee')
    // Levée = brouillon : rien n'est de nouveau visible → AUCUN événement.
    expect(offreIndisponible).not.toHaveBeenCalled()
  })

  it('refus (count 0 : offre relevée entre-temps) → ?erreur=statut', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await expect(releverOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

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
      await expect(releverOffre(formOf({ id: idForge }))).rejects.toThrow('NEXT_NOT_FOUND')
    }

    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('offre inexistante ou supprimée → notFound ET PAS de redirect', async () => {
    // `deletedAt: null` dans le where : supprimée logiquement = même 404.
    offreFindFirst.mockResolvedValue(null)

    await expect(suspendreOffre(formOf({ id: '999' }))).rejects.toThrow('NEXT_NOT_FOUND')

    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 999, deletedAt: null })
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('sécurité payload (matrice seule)', () => {
  it('ignore statut/entrepriseId/deletedAt/slug forges sur T8', async () => {
    await expect(
      suspendreOffre(
        formOf({
          id: '42',
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
    // Le where reste piloté par la matrice : id de la session formée,
    // deletedAt null et contrainte de statut — aucune clé venue du payload.
    expect(appel?.where).toEqual({
      id: 42,
      deletedAt: null,
      statut: { in: ['publiee', 'brouillon', 'cloturee'] },
    })
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=suspendue')
  })

  it('ignore un statut forge sur T9 (la cible reste brouillon)', async () => {
    await expect(
      releverOffre(formOf({ id: '42', statut: 'publiee', entrepriseId: '9' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(offreUpdateMany.mock.calls[0]?.[0].data).toEqual({ statut: 'brouillon' })
    expect(redirect).toHaveBeenCalledWith('/admin/offres?maj=levee')
  })
})

describe('rôles', () => {
  it('verifyRole(’admin’) en premier : rôle insuffisant → aucune requête (T8)', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT'))

    await expect(suspendreOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(verifyRole).toHaveBeenCalledWith('admin')
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('verifyRole(’admin’) en premier : rôle insuffisant → aucune requête (T9)', async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT'))

    await expect(releverOffre(formOf({ id: '42' }))).rejects.toThrow('NEXT_REDIRECT')

    expect(verifyRole).toHaveBeenCalledWith('admin')
    expect(offreFindFirst).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
