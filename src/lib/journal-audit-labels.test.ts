import { describe, expect, it } from 'vitest'

import {
  ACTIONS_AUDIT,
  ACTIONS_AUDIT_GENERIQUES,
  CIBLES_AUDIT,
  CIBLES_AUDIT_GENERIQUES,
  LIBELLES_ACTION_AUDIT,
  LIBELLES_CIBLE_AUDIT,
  LIBELLES_SOURCE_AUDIT,
  SOURCES_AUDIT,
  estActionAudit,
  estActionAuditGenerique,
  estCibleAudit,
  estSourceAudit,
  libelleActionAudit,
  libelleCibleAudit,
  libelleSourceAudit,
} from './journal-audit-labels'

describe('catalogue du journal audit', () => {
  it('fournit un libellé non vide pour chaque source, action et cible connue', () => {
    for (const source of SOURCES_AUDIT) {
      expect(LIBELLES_SOURCE_AUDIT[source].length).toBeGreaterThan(0)
    }
    for (const action of ACTIONS_AUDIT) {
      expect(LIBELLES_ACTION_AUDIT[action].length).toBeGreaterThan(0)
    }
    for (const cible of CIBLES_AUDIT) {
      expect(LIBELLES_CIBLE_AUDIT[cible].length).toBeGreaterThan(0)
    }
  })

  it('garde les actions génériques dans le catalogue complet', () => {
    for (const action of ACTIONS_AUDIT_GENERIQUES) {
      expect(ACTIONS_AUDIT).toContain(action)
    }
    for (const cible of CIBLES_AUDIT_GENERIQUES) {
      expect(CIBLES_AUDIT).toContain(cible)
    }
  })

  it('refuse les valeurs inconnues et n’affiche jamais la valeur brute', () => {
    expect(estSourceAudit('generique')).toBe(true)
    expect(estSourceAudit('inconnue')).toBe(false)
    expect(estActionAudit('connexion_admin')).toBe(true)
    expect(estActionAudit('suppression_totale')).toBe(false)
    expect(estCibleAudit('utilisateur')).toBe(true)
    expect(estCibleAudit('base')).toBe(false)

    expect(libelleSourceAudit('inconnue')).toBe('Source inconnue')
    expect(libelleActionAudit('suppression_totale')).toBe('Action inconnue')
    expect(libelleCibleAudit('base')).toBe('Cible inconnue')
  })

  it('limite l’écriture aux actions et cibles M10', () => {
    expect(estActionAuditGenerique('decision_signalement')).toBe(true)
    expect(estActionAuditGenerique('creation')).toBe(false)
    expect(estActionAuditGenerique('transition')).toBe(false)
  })
})
