import { describe, expect, it } from 'vitest'

import {
  schemaReactivationOffre,
  schemaReactivationUtilisateur,
  schemaSuspensionOffre,
  schemaSuspensionUtilisateur,
} from './admin-gestion-schemas'

// ─── Schémas fermés de gestion admin (M10) ──────────────────────────────────
// Le motif vient d'un catalogue borné, l'identifiant est un entier positif et
// toute clé inconnue est refusée. Ces schémas sont la seule porte d'entrée des
// actions de suspension/réactivation.
// ---------------------------------------------------------------------------

describe('schémas de gestion admin', () => {
  it('accepte une suspension utilisateur valide avec note', () => {
    const parse = schemaSuspensionUtilisateur.safeParse({
      userId: '7',
      motif: 'comportement',
      noteInterne: 'Note',
    })

    expect(parse.success).toBe(true)
    if (parse.success) {
      expect(parse.data).toEqual({
        userId: 7,
        motif: 'comportement',
        noteInterne: 'Note',
      })
    }
  })

  it('accepte la réactivation et les actions sur offre', () => {
    expect(
      schemaReactivationUtilisateur.safeParse({
        userId: 7,
        motif: 'demande_utilisateur',
      }).success,
    ).toBe(true)
    expect(
      schemaSuspensionOffre.safeParse({ offreId: 12, motif: 'qualite' }).success,
    ).toBe(true)
    expect(
      schemaReactivationOffre.safeParse({ offreId: 12, motif: 'autre' }).success,
    ).toBe(true)
  })

  it.each([
    ['identifiant nul', { userId: 0, motif: 'comportement' }],
    ['identifiant négatif', { userId: -1, motif: 'comportement' }],
    ['identifiant décimal', { userId: 1.5, motif: 'comportement' }],
    ['motif inconnu', { userId: 1, motif: 'invente' }],
    ['motif absent', { userId: 1 }],
    ['note trop longue', { userId: 1, motif: 'comportement', noteInterne: 'x'.repeat(2001) }],
  ])('refuse %s', (_cas, payload) => {
    expect(schemaSuspensionUtilisateur.safeParse(payload).success).toBe(false)
  })

  it('refuse une clé inconnue (mass assignment)', () => {
    const parse = schemaSuspensionUtilisateur.safeParse({
      userId: 1,
      motif: 'comportement',
      role: 'admin',
      isActive: false,
    })

    expect(parse.success).toBe(false)
  })

  it('refuse un motif de suspension utilisateur sur une offre', () => {
    expect(
      schemaSuspensionOffre.safeParse({ offreId: 1, motif: 'comportement' })
        .success,
    ).toBe(false)
  })
})
