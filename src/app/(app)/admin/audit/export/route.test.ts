import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reauthAdminValide } from '@/lib/admin-reauth'
import { requireAdmin } from '@/lib/dal'
import {
  consignerAudit,
  lireJournalAuditPourExport,
  type LigneJournalAudit,
} from '@/lib/journal-audit'

import * as route from './route'

vi.mock('@/lib/dal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin-reauth', () => ({ reauthAdminValide: vi.fn() }))
vi.mock('@/lib/journal-audit', () => ({
  consignerAudit: vi.fn(),
  lireJournalAuditPourExport: vi.fn(),
}))

// ─── Export CSV du journal d'audit (M10) ───────────────────────────────────
// L'export est une action sensible : un grant de réauthentification de
// 5 minutes est exigé AVANT toute lecture ou écriture. Sans grant, aucun
// filtre n'est lu, aucune ligne n'est exportée et aucun audit n'est écrit.
// Avec grant, l'audit est écrit avant l'envoi du fichier et la troncature
// reste signalée par `X-Export-Truncated`.
// ---------------------------------------------------------------------------

const LIGNE: LigneJournalAudit = {
  source: 'generique',
  entreeId: 12,
  acteurId: 7,
  acteurNom: 'Admin E2E',
  action: 'export_audit',
  cibleType: 'systeme',
  cibleId: null,
  motif: null,
  commentaire: 'Trace de test',
  createdAt: new Date('2026-11-04T10:00:00.000Z'),
}

function requete(url: string): NextRequest {
  return new NextRequest(url)
}

describe('GET /admin/audit/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue({
      userId: 7,
      role: 'admin',
      sessionVersion: 1,
    })
    vi.mocked(reauthAdminValide).mockResolvedValue(true)
    vi.mocked(lireJournalAuditPourExport).mockResolvedValue({
      lignes: [LIGNE],
      total: 1,
      page: 1,
      taille: 5000,
      pages: 1,
    })
    vi.mocked(consignerAudit).mockResolvedValue(undefined)
  })

  it('redirige vers la réauthentification sans grant, sans lire ni écrire', async () => {
    vi.mocked(reauthAdminValide).mockResolvedValue(false)

    const response = await route.GET(
      requete(
        'http://localhost:3000/admin/audit/export?source=generique&action=export_audit',
      ),
    )

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/admin/reauth')
    expect(location.searchParams.get('retour')).toBe(
      '/admin/audit/export?source=generique&action=export_audit',
    )
    expect(reauthAdminValide).toHaveBeenCalledWith(7)
    expect(lireJournalAuditPourExport).not.toHaveBeenCalled()
    expect(consignerAudit).not.toHaveBeenCalled()
  })

  it('exporte le CSV après grant et écrit l’audit avant la réponse', async () => {
    const response = await route.GET(
      requete('http://localhost:3000/admin/audit/export?source=generique'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-export-truncated')).toBe('false')
    expect(response.headers.get('content-disposition')).toContain(
      'journal-audit-',
    )

    const csv = await response.text()
    expect(csv).toContain('"source";"entree_id"')
    expect(csv).toContain('"export_audit"')
    expect(consignerAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: 7,
        action: 'export_audit',
        cibleType: 'systeme',
        commentaire: expect.stringContaining('1 ligne(s) sur 1'),
      }),
    )
  })

  it('signale la troncature sans inventer de lignes', async () => {
    vi.mocked(lireJournalAuditPourExport).mockResolvedValue({
      lignes: [LIGNE],
      total: 6000,
      page: 1,
      taille: 5000,
      pages: 2,
    })

    const response = await route.GET(
      requete('http://localhost:3000/admin/audit/export'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-export-truncated')).toBe('true')
    expect(consignerAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        commentaire: expect.stringContaining('1 ligne(s) sur 6000'),
      }),
    )
  })

  it('ne lit rien si requireAdmin refuse', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('NEXT_NOT_FOUND'))

    await expect(
      route.GET(requete('http://localhost:3000/admin/audit/export')),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(reauthAdminValide).not.toHaveBeenCalled()
    expect(lireJournalAuditPourExport).not.toHaveBeenCalled()
    expect(consignerAudit).not.toHaveBeenCalled()
  })
})
