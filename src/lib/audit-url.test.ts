import { describe, expect, it } from 'vitest'

import { lireFiltresAudit } from './audit-url'

// ─── Filtres d'URL du journal d'audit (M10) ─────────────────────────────────
// Seuls les catalogues fermés passent ; une valeur inconnue est ignorée et
// n'atteint jamais le SQL. Les dates civiles sont bornées à Douala.
// ---------------------------------------------------------------------------

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

describe('lireFiltresAudit', () => {
  it('accepte les filtres du catalogue et les identifiants positifs', () => {
    const { filtres, parametres } = lireFiltresAudit(
      params({
        source: 'generique',
        action: 'suspension_utilisateur',
        cibleType: 'utilisateur',
        motif: 'comportement',
        acteurId: '42',
        cibleId: '7',
      }),
    )

    expect(filtres).toEqual({
      source: 'generique',
      action: 'suspension_utilisateur',
      cibleType: 'utilisateur',
      motif: 'comportement',
      acteurId: 42,
      cibleId: 7,
    })
    expect(parametres).toMatchObject({
      source: 'generique',
      action: 'suspension_utilisateur',
      cibleType: 'utilisateur',
      motif: 'comportement',
      acteurId: '42',
      cibleId: '7',
    })
  })

  it('ignore les valeurs inconnues, les ids invalides et les dates malformées', () => {
    const { filtres, parametres } = lireFiltresAudit(
      params({
        source: 'source_inconnue',
        action: 'action_inconnue',
        cibleType: 'cible_inconnue',
        motif: 'motif_inconnu',
        acteurId: '0',
        cibleId: '12.5',
        du: '2026-13-40',
        au: 'hier',
      }),
    )

    expect(filtres).toEqual({})
    expect(parametres).toEqual({
      source: undefined,
      action: undefined,
      cibleType: undefined,
      motif: undefined,
      acteurId: undefined,
      cibleId: undefined,
      du: undefined,
      au: undefined,
    })
  })

  it('interprète les dates civiles à Douala, borne haute inclusive', () => {
    const { filtres } = lireFiltresAudit(
      params({ du: '2026-10-15', au: '2026-10-16' }),
    )

    expect(filtres.du?.toISOString()).toBe('2026-10-14T23:00:00.000Z')
    expect(filtres.au?.toISOString()).toBe('2026-10-16T22:59:59.999Z')
  })

  it('ne recopie pas un paramètre répété ou vide', () => {
    const sp = new URLSearchParams()
    sp.append('source', 'generique')
    sp.append('source', 'candidatures')
    sp.set('action', '')

    const { filtres, parametres } = lireFiltresAudit(sp)

    expect(filtres.source).toBe('generique')
    expect(filtres.action).toBeUndefined()
    expect(parametres.source).toBe('generique')
    expect(parametres.action).toBeUndefined()
  })
})
