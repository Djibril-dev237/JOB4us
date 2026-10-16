import { describe, expect, it, vi } from 'vitest'

import { offreIndisponible, offrePubliee } from '@/lib/evenements-offres'

// ─── Contrat des hooks d'offre (M9, no-op tant que non branchés) ─────────────
//
// Verrou du POINT DE BRANCHEMENT M5/M6 : les actions offres appellent ces
// fonctions APRÈS un compare-and-set réussi et AVANT la redirection. Le
// contrat du module (jamais d'exception, jamais de log, toujours `void`)
// doit survivre à n'importe quel appel — les actions ne peuvent pas voir
// leur verdict modifié par un événement.
// ---------------------------------------------------------------------------

const EVENEMENT = { offreId: 12 }

describe('hooks M9 des offres — contrat no-op', () => {
  it('offrePubliee et offreIndisponible retournent void sans effet de bord', () => {
    const consoleErreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(offrePubliee(EVENEMENT)).toBeUndefined()
    expect(offreIndisponible(EVENEMENT)).toBeUndefined()

    // AUCUN log : un événement ne pollue jamais la sortie d'une action.
    expect(consoleErreur).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()

    consoleErreur.mockRestore()
    consoleLog.mockRestore()
  })

  it('charge utile inattendue : aucune lecture de champ, aucun throw (contrat no-throw)', () => {
    expect(() =>
      offrePubliee({ offreId: Number.NaN }),
    ).not.toThrow()
    expect(() => offreIndisponible({} as { offreId: number })).not.toThrow()
  })
})
