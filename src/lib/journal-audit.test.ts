import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@prisma/client'

import {
  MAX_LIGNES_EXPORT_AUDIT,
  MAX_LIGNES_PAGE_AUDIT,
  consignerAudit,
  lireJournalAudit,
  lireJournalAuditPourExport,
} from './journal-audit'

const { journalCreate, queryRaw } = vi.hoisted(() => ({
  journalCreate: vi.fn<
    (args: { data: Record<string, unknown> }) => Promise<unknown>
  >(),
  queryRaw: vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: queryRaw,
    journalAudit: { create: journalCreate },
  },
}))

const db = {
  journalAudit: { create: journalCreate },
} as unknown as PrismaClient

beforeEach(() => {
  journalCreate.mockReset()
  journalCreate.mockResolvedValue({})
  queryRaw.mockReset()
})

describe('consignerAudit', () => {
  it('écrit une trace avec les valeurs normalisées', async () => {
    await consignerAudit(db, {
      acteurId: 7,
      action: 'suspension_utilisateur',
      cibleType: 'utilisateur',
      cibleId: 42,
      motif: 'securite',
      commentaire: '  comportement signalé  ',
    })

    expect(journalCreate).toHaveBeenCalledWith({
      data: {
        acteurId: 7,
        action: 'suspension_utilisateur',
        cibleType: 'utilisateur',
        cibleId: 42,
        motif: 'securite',
        commentaire: 'comportement signalé',
      },
    })
  })

  it('borne le commentaire et remplace une absence par null', async () => {
    await consignerAudit(db, {
      acteurId: 7,
      action: 'export_audit',
      cibleType: 'systeme',
      commentaire: 'x'.repeat(2500),
    })

    const data = journalCreate.mock.calls[0]?.[0].data
    expect(data?.cibleId).toBeNull()
    expect(data?.motif).toBeNull()
    expect(data?.commentaire).toHaveLength(2000)
  })

  it('propage une erreur d’écriture (fail-closed)', async () => {
    journalCreate.mockRejectedValueOnce(new Error('db indisponible'))
    await expect(
      consignerAudit(db, {
        acteurId: 7,
        action: 'decision_signalement',
        cibleType: 'signalement',
        cibleId: 3,
        motif: 'spam',
      }),
    ).rejects.toThrow('db indisponible')
  })
})

describe('lireJournalAudit', () => {
  it('mappe la vue, joint le nom de l’acteur et borne la pagination', async () => {
    const createdAt = new Date('2026-10-28T10:00:00.000Z')
    queryRaw
      .mockResolvedValueOnce([
        {
          source: 'generique',
          entree_id: 9,
          acteur_id: 7,
          acteur_nom: 'Ada Admin',
          action: 'suspension_utilisateur',
          cible_type: 'utilisateur',
          cible_id: 42,
          motif: 'securite',
          commentaire: 'compte suspendu',
          created_at: createdAt,
        },
        {
          source: 'inconnue',
          entree_id: 8,
          acteur_id: 3,
          acteur_nom: null,
          action: 'action_inconnue',
          cible_type: 'inconnue',
          cible_id: null,
          motif: null,
          commentaire: null,
          created_at: createdAt,
        },
      ])
      .mockResolvedValueOnce([{ total: BigInt(2) }])

    const resultat = await lireJournalAudit({}, 0, 1000)

    expect(resultat).toEqual({
      lignes: [
        {
          source: 'generique',
          entreeId: 9,
          acteurId: 7,
          acteurNom: 'Ada Admin',
          action: 'suspension_utilisateur',
          cibleType: 'utilisateur',
          cibleId: 42,
          motif: 'securite',
          commentaire: 'compte suspendu',
          createdAt,
        },
        {
          source: 'generique',
          entreeId: 8,
          acteurId: 3,
          acteurNom: null,
          action: 'action_inconnue',
          cibleType: 'inconnue',
          cibleId: null,
          motif: null,
          commentaire: null,
          createdAt,
        },
      ],
      total: 2,
      page: 1,
      taille: MAX_LIGNES_PAGE_AUDIT,
      pages: 1,
    })
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })

  it('plafonne la taille de page et calcule le nombre de pages', async () => {
    queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 251 }])

    const resultat = await lireJournalAudit({}, 3, 500)

    expect(resultat.page).toBe(3)
    expect(resultat.taille).toBe(MAX_LIGNES_PAGE_AUDIT)
    expect(resultat.pages).toBe(3)
  })

  it('utilise le plafond d’export et transmet la limite à la requête', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 6000 }])

    const resultat = await lireJournalAuditPourExport()
    expect(resultat.taille).toBe(MAX_LIGNES_EXPORT_AUDIT)
    const valeurs = queryRaw.mock.calls[0]?.slice(1) ?? []
    expect(valeurs).toContain(MAX_LIGNES_EXPORT_AUDIT)
  })
})
