import { describe, expect, it } from 'vitest'

import {
  schemaAccesConversation,
  schemaDecisionSignalement,
  schemaRetablissementMessage,
} from './moderation-schemas'

// ─── Schémas de modération M10 ───────────────────────────────────────────────
// Les catalogues sont fermés et les objets sont `.strict()` : un champ forgé
// ne peut pas atteindre l'action, une décision ou un motif inconnu est refusé.
// ---------------------------------------------------------------------------

describe('schemaAccesConversation', () => {
  it('accepte un id borné et un motif du catalogue', () => {
    expect(
      schemaAccesConversation.safeParse({ signalementId: 7, motif: 'enquete' }).success,
    ).toBe(true)
  })

  it('refuse un motif libre, un id non entier et une clé inconnue', () => {
    expect(
      schemaAccesConversation.safeParse({ signalementId: 7, motif: 'libre' }).success,
    ).toBe(false)
    expect(
      schemaAccesConversation.safeParse({ signalementId: 1.5, motif: 'enquete' }).success,
    ).toBe(false)
    expect(
      schemaAccesConversation.safeParse({
        signalementId: 7,
        motif: 'enquete',
        adminId: 1,
      }).success,
    ).toBe(false)
  })
})

describe('schemaDecisionSignalement', () => {
  it('accepte les quatre décisions du catalogue', () => {
    for (const decision of ['sans_suite', 'avertissement', 'masquage', 'suspension']) {
      expect(
        schemaDecisionSignalement.safeParse({
          signalementId: 7,
          decision,
          motif: 'spam',
        }).success,
      ).toBe(true)
    }
  })

  it('refuse une décision hors catalogue et une note trop longue', () => {
    expect(
      schemaDecisionSignalement.safeParse({
        signalementId: 7,
        decision: 'suppression',
        motif: 'spam',
      }).success,
    ).toBe(false)
    expect(
      schemaDecisionSignalement.safeParse({
        signalementId: 7,
        decision: 'masquage',
        motif: 'spam',
        noteInterne: 'x'.repeat(2001),
      }).success,
    ).toBe(false)
  })
})

describe('schemaRetablissementMessage', () => {
  it('accepte un motif de rétablissement et une note optionnelle', () => {
    expect(
      schemaRetablissementMessage.safeParse({ messageId: 99, motif: 'recours_fonde' })
        .success,
    ).toBe(true)
  })

  it('refuse un motif de décision réutilisé par erreur', () => {
    expect(
      schemaRetablissementMessage.safeParse({ messageId: 99, motif: 'spam' }).success,
    ).toBe(false)
  })
})
