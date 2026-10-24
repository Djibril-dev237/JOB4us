import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FENETRE_RATTRAPAGE_JOURS,
  notifierOffresExpirees,
} from './notifications-expiration'

// ─── Tests du scan d'expiration (M9, correctif Vague 3) ─────────────────────
// Verrous :
//  1. FRONTIÈRE : le scan vise `dateExpiration < minuit Douala du jour` dans
//     une fenêtre de rattrapage bornée, jamais les offres encore visibles ;
//  2. PÉRIMÈTRE : publiee + non supprimée + au moins une candidature ;
//  3. DIFFUSION : une notification par candidat, avec le texte et le lien
//     `offreIndisponible` existants ;
//  4. IDEMPOTENCE : une clé déjà présente n'est jamais réémise ;
//  5. TOLÉRANCE : un échec unitaire d'émission n'interrompt pas le lot.
// ---------------------------------------------------------------------------

interface ArgsOffreFindMany {
  where?: {
    statut?: string
    deletedAt?: null
    dateExpiration?: { lt?: Date; gte?: Date }
    candidatures?: { some?: object }
  }
}

interface ArgsCandidatureFindMany {
  where?: { offreId?: { in: number[] } }
}

interface ArgsNotificationFindMany {
  where?: { cle?: { in: string[] } }
}

const { offreFindMany, candidatureFindMany, notificationFindMany, emettre } =
  vi.hoisted(() => ({
    offreFindMany: vi.fn<(args: ArgsOffreFindMany) => Promise<unknown>>(),
    candidatureFindMany:
      vi.fn<(args: ArgsCandidatureFindMany) => Promise<unknown>>(),
    notificationFindMany:
      vi.fn<(args: ArgsNotificationFindMany) => Promise<unknown>>(),
    emettre: vi.fn<(args: unknown) => Promise<unknown>>(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findMany: offreFindMany },
    candidature: { findMany: candidatureFindMany },
    notification: { findMany: notificationFindMany },
  },
}))

vi.mock('@/lib/notifications-emission', () => ({
  cleNotification: (
    type: string,
    refId: number,
    destinataireId: number,
  ): string => `${type}:${refId}:${destinataireId}`,
  emettreNotification: emettre,
}))

// 2026-10-24 09:00 à Douala → minuit local = 2026-10-23T23:00Z.
const MAINTENANT = new Date('2026-10-24T08:00:00Z')
const SEUIL = new Date('2026-10-23T23:00:00.000Z')
const DEBUT_FENETRE = new Date(
  SEUIL.getTime() - FENETRE_RATTRAPAGE_JOURS * 24 * 60 * 60 * 1000,
)

const OFFRES = [
  { id: 3, titre: 'Développeur' },
  { id: 4, titre: 'Designer' },
]

const CANDIDATURES = [
  { offreId: 3, candidatId: 10 },
  { offreId: 3, candidatId: 11 },
  { offreId: 4, candidatId: 10 },
]

beforeEach(() => {
  offreFindMany.mockReset()
  candidatureFindMany.mockReset()
  notificationFindMany.mockReset()
  emettre.mockReset()

  offreFindMany.mockResolvedValue(OFFRES)
  candidatureFindMany.mockResolvedValue(CANDIDATURES)
  notificationFindMany.mockResolvedValue([])
  emettre.mockResolvedValue({ notificationId: 1 })
})

describe('périmètre et frontière du scan', () => {
  it('vise les offres publiees non supprimées, expirées dans la fenêtre de rattrapage', async () => {
    await notifierOffresExpirees(MAINTENANT)

    expect(offreFindMany).toHaveBeenCalledTimes(1)
    expect(offreFindMany.mock.calls[0]?.[0]?.where).toEqual({
      statut: 'publiee',
      deletedAt: null,
      dateExpiration: { lt: SEUIL, gte: DEBUT_FENETRE },
      candidatures: { some: {} },
    })
    expect(FENETRE_RATTRAPAGE_JOURS).toBe(7)
  })

  it('aucune offre expirée → aucun scan de candidatures, bilan à zéro', async () => {
    offreFindMany.mockResolvedValue([])

    await expect(notifierOffresExpirees(MAINTENANT)).resolves.toEqual({
      offres: 0,
      notifications: 0,
    })
    expect(candidatureFindMany).not.toHaveBeenCalled()
    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(emettre).not.toHaveBeenCalled()
  })
})

describe('émission vers chaque candidat', () => {
  it('émet une notification par candidat avec le texte et le lien existants', async () => {
    const bilan = await notifierOffresExpirees(MAINTENANT)

    expect(candidatureFindMany).toHaveBeenCalledWith({
      where: { offreId: { in: [3, 4] } },
      select: { offreId: true, candidatId: true },
      orderBy: [{ offreId: 'asc' }, { candidatId: 'asc' }],
    })

    expect(emettre).toHaveBeenCalledTimes(3)
    expect(emettre.mock.calls.map((appel) => appel[0])).toEqual([
      {
        destinataireId: 10,
        type: 'offreIndisponible',
        refId: 3,
        lien: '/candidat/candidatures',
        variables: { type: 'offreIndisponible', titreOffre: 'Développeur' },
      },
      {
        destinataireId: 11,
        type: 'offreIndisponible',
        refId: 3,
        lien: '/candidat/candidatures',
        variables: { type: 'offreIndisponible', titreOffre: 'Développeur' },
      },
      {
        destinataireId: 10,
        type: 'offreIndisponible',
        refId: 4,
        lien: '/candidat/candidatures',
        variables: { type: 'offreIndisponible', titreOffre: 'Designer' },
      },
    ])
    expect(bilan).toEqual({ offres: 2, notifications: 3 })
  })

  it('une clé déjà présente est ignorée (rejeu = aucune réémission)', async () => {
    notificationFindMany.mockResolvedValue([
      { cle: 'offreIndisponible:3:10' },
      { cle: 'offreIndisponible:3:11' },
      { cle: 'offreIndisponible:4:10' },
    ])

    const bilan = await notifierOffresExpirees(MAINTENANT)

    expect(notificationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      cle: {
        in: [
          'offreIndisponible:3:10',
          'offreIndisponible:3:11',
          'offreIndisponible:4:10',
        ],
      },
    })
    expect(emettre).not.toHaveBeenCalled()
    expect(bilan).toEqual({ offres: 2, notifications: 0 })
  })

  it('émet uniquement pour les clés absentes', async () => {
    notificationFindMany.mockResolvedValue([{ cle: 'offreIndisponible:3:11' }])

    const bilan = await notifierOffresExpirees(MAINTENANT)

    expect(emettre.mock.calls.map((appel) => appel[0])).toMatchObject([
      { destinataireId: 10, refId: 3 },
      { destinataireId: 10, refId: 4 },
    ])
    expect(bilan).toEqual({ offres: 2, notifications: 2 })
  })
})

describe('tolérance aux échecs', () => {
  it('un échec unitaire d’émission n’interrompt pas le lot', async () => {
    emettre
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ notificationId: 2 })
      .mockResolvedValueOnce({ notificationId: 3 })

    const bilan = await notifierOffresExpirees(MAINTENANT)

    expect(emettre).toHaveBeenCalledTimes(3)
    expect(bilan).toEqual({ offres: 2, notifications: 2 })
  })
})
