import { describe, expect, it } from 'vitest'

import {
  DECISIONS_SIGNALEMENT,
  LIBELLES_DECISION,
  LIBELLES_MOTIF,
  MOTIFS_ACCES_CONVERSATION,
  MOTIFS_AUDIT,
  MOTIFS_DECISION_SIGNALEMENT,
  MOTIFS_RETABLISSEMENT,
  MOTIFS_SUSPENSION_OFFRE,
  MOTIFS_SUSPENSION_UTILISATEUR,
  decisionMasqueMessage,
  decisionSuspendCompte,
  estDecisionSignalement,
  estMotifAudit,
  libelleDecision,
  libelleMotif,
} from './moderation-labels'

describe('décisions de signalement', () => {
  it('couvre les quatre décisions avec un libellé', () => {
    expect(DECISIONS_SIGNALEMENT).toEqual([
      'sans_suite',
      'avertissement',
      'masquage',
      'suspension',
    ])
    for (const decision of DECISIONS_SIGNALEMENT) {
      expect(LIBELLES_DECISION[decision].length).toBeGreaterThan(0)
    }
  })

  it('exprime les effets de masquage et de suspension', () => {
    expect(decisionMasqueMessage('masquage')).toBe(true)
    expect(decisionMasqueMessage('suspension')).toBe(true)
    expect(decisionMasqueMessage('sans_suite')).toBe(false)
    expect(decisionMasqueMessage('avertissement')).toBe(false)
    expect(decisionSuspendCompte('suspension')).toBe(true)
    expect(decisionSuspendCompte('masquage')).toBe(false)
  })

  it('refuse une décision inconnue sans afficher la valeur brute', () => {
    expect(estDecisionSignalement('suspension')).toBe(true)
    expect(estDecisionSignalement('suppression')).toBe(false)
    expect(libelleDecision(null)).toBe('Décision non renseignée')
    expect(libelleDecision('suppression')).toBe('Décision inconnue')
  })
})

describe('motifs de modération', () => {
  it('fournit un libellé pour chaque motif de chaque contexte', () => {
    const listes = [
      MOTIFS_DECISION_SIGNALEMENT,
      MOTIFS_SUSPENSION_UTILISATEUR,
      MOTIFS_SUSPENSION_OFFRE,
      MOTIFS_ACCES_CONVERSATION,
      MOTIFS_RETABLISSEMENT,
    ]
    for (const liste of listes) {
      for (const motif of liste) {
        expect(LIBELLES_MOTIF[motif].length).toBeGreaterThan(0)
      }
    }
  })

  it('garde la liste d’audit comme union des contextes', () => {
    for (const motif of MOTIFS_AUDIT) {
      expect(estMotifAudit(motif)).toBe(true)
    }
    expect(estMotifAudit('motif_libre')).toBe(false)
    expect(libelleMotif('motif_libre')).toBe('Motif inconnu')
    expect(libelleMotif(null)).toBe('Motif non renseigné')
  })
})
