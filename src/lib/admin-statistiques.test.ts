import { beforeEach, describe, expect, it, vi } from 'vitest'

import { lireStatistiquesAdmin } from './admin-statistiques'

// ─── Tests des statistiques admin (M10) ─────────────────────────────────────
// La page ne calcule rien : chaque valeur vient d'une requête bornée. Les
// tests vérifient les fenêtres exactes (30 jours glissants, frontière Douala
// pour l'expiration), l'égalité entre les compteurs simulés et le résultat,
// et l'absence de métrique inventée quand aucune donnée n'existe.
// ---------------------------------------------------------------------------

const {
  offreCount,
  candidatureCount,
  userCount,
  signalementCount,
  signalementFindFirst,
  signalementFindMany,
  transaction,
} = vi.hoisted(() => ({
  offreCount: vi.fn<(args: { where?: Record<string, unknown> }) => Promise<number>>(),
  candidatureCount: vi.fn<(args: { where?: Record<string, unknown> }) => Promise<number>>(),
  userCount: vi.fn<(args: { where?: Record<string, unknown> }) => Promise<number>>(),
  signalementCount: vi.fn<(args: { where?: Record<string, unknown> }) => Promise<number>>(),
  signalementFindFirst: vi.fn<(args: unknown) => Promise<unknown>>(),
  signalementFindMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  transaction: vi.fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { count: offreCount },
    candidature: { count: candidatureCount },
    user: { count: userCount },
    signalement: {
      count: signalementCount,
      findFirst: signalementFindFirst,
      findMany: signalementFindMany,
    },
    $transaction: transaction,
  },
}))

const MAINTENANT = new Date('2026-10-15T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  transaction.mockImplementation(async (operations) => Promise.all(operations))
  offreCount.mockImplementation(async ({ where }) => {
    if (where?.statut === 'suspendue') return 3
    return 12
  })
  candidatureCount.mockResolvedValue(44)
  userCount.mockImplementation(async ({ where }) => {
    if (where?.isActive === false) return 5
    return 9
  })
  signalementCount.mockResolvedValue(6)
  signalementFindFirst.mockResolvedValue({
    createdAt: new Date('2026-10-12T12:00:00.000Z'),
  })
  signalementFindMany.mockResolvedValue([
    {
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      traiteLe: new Date('2026-10-01T10:00:00.000Z'),
    },
    {
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      traiteLe: new Date('2026-10-02T20:00:00.000Z'),
    },
  ])
})

describe('lireStatistiquesAdmin', () => {
  it('retourne exactement les valeurs des requêtes, sans métrique inventée', async () => {
    const stats = await lireStatistiquesAdmin(MAINTENANT)

    expect(stats).toEqual({
      offresActives: 12,
      candidatures30Jours: 44,
      comptes30Jours: 9,
      signalementsOuverts: 6,
      signalementPlusAncienJours: 3,
      delaiMoyenTraitementHeures: 15,
      comptesSuspendus: 5,
      offresSuspendues: 3,
    })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('borne les offres actives à la frontière de Douala', async () => {
    await lireStatistiquesAdmin(MAINTENANT)

    const appelActif = offreCount.mock.calls.find(
      ([args]) => args.where?.statut === 'publiee',
    )
    expect(appelActif?.[0].where).toEqual({
      statut: 'publiee',
      deletedAt: null,
      dateExpiration: { gte: new Date('2026-10-14T23:00:00.000Z') },
    })
  })

  it('borne les candidatures et les comptes à 30 jours glissants', async () => {
    await lireStatistiquesAdmin(MAINTENANT)

    const attendu = new Date('2026-09-15T12:00:00.000Z')
    expect(candidatureCount).toHaveBeenCalledWith({
      where: { createdAt: { gte: attendu } },
    })
    expect(userCount).toHaveBeenCalledWith({
      where: { createdAt: { gte: attendu }, anonymizedAt: null },
    })
  })

  it('ne calcule le délai moyen que sur les signalements traités sur 30 jours', async () => {
    await lireStatistiquesAdmin(MAINTENANT)

    expect(signalementFindMany).toHaveBeenCalledWith({
      where: {
        statut: 'traite',
        traiteLe: { gte: new Date('2026-09-15T12:00:00.000Z') },
      },
      select: { createdAt: true, traiteLe: true },
    })
  })

  it('renvoie N/A et aucun plus ancien quand la file est vide', async () => {
    signalementCount.mockResolvedValue(0)
    signalementFindFirst.mockResolvedValue(null)
    signalementFindMany.mockResolvedValue([])

    const stats = await lireStatistiquesAdmin(MAINTENANT)

    expect(stats.signalementsOuverts).toBe(0)
    expect(stats.signalementPlusAncienJours).toBeNull()
    expect(stats.delaiMoyenTraitementHeures).toBeNull()
  })

  it('ignore un traiteLe incohérent (antérieur à la création)', async () => {
    signalementFindMany.mockResolvedValue([
      {
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        traiteLe: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        traiteLe: new Date('2026-10-01T04:00:00.000Z'),
      },
    ])

    const stats = await lireStatistiquesAdmin(MAINTENANT)

    expect(stats.delaiMoyenTraitementHeures).toBe(4)
  })
})
