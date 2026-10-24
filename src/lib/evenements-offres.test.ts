import { beforeEach, describe, expect, it, vi } from 'vitest'

import { offreIndisponible, offrePubliee } from '@/lib/evenements-offres'
import {
  notifierOffreIndisponible,
  notifierOffrePubliee,
} from '@/lib/notifications-evenements'

// ─── Contrat des hooks d'offre (M9 BRANCHÉ, Vague 2) ────────────────────────
//
// Verrou du POINT DE BRANCHEMENT M5/M6 : les actions offres appellent ces
// fonctions APRÈS un compare-and-set réussi et AVANT la redirection — un
// seul point d'appel par événement, quels que soient les sites (T4, T8
// admin, T10). Le contrat du module (jamais d'exception, jamais de log,
// toujours `void`) doit survivre à n'importe quel appel — les actions ne
// peuvent pas voir leur verdict modifié par un événement, et la résolution
// des destinataires appartient au résolveur mocké ici, pas au hook.
// ---------------------------------------------------------------------------

vi.mock('@/lib/notifications-evenements', () => ({
  notifierOffrePubliee: vi.fn(async () => undefined),
  notifierOffreIndisponible: vi.fn(async () => undefined),
}))

const notifierPubliee = vi.mocked(notifierOffrePubliee)
const notifierIndisponible = vi.mocked(notifierOffreIndisponible)

const EVENEMENT = { offreId: 12 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hooks offres — branchement M9 (un seul point d’appel)', () => {
  it('offrePubliee délègue au résolveur avec le payload exact', () => {
    expect(offrePubliee(EVENEMENT)).toBeUndefined()

    expect(notifierPubliee).toHaveBeenCalledTimes(1)
    expect(notifierPubliee).toHaveBeenCalledWith(EVENEMENT)
    expect(notifierIndisponible).not.toHaveBeenCalled()
  })

  it('offreIndisponible délègue au résolveur avec le payload exact', () => {
    expect(offreIndisponible(EVENEMENT)).toBeUndefined()

    expect(notifierIndisponible).toHaveBeenCalledTimes(1)
    expect(notifierIndisponible).toHaveBeenCalledWith(EVENEMENT)
    expect(notifierPubliee).not.toHaveBeenCalled()
  })

  it('AUCUN log : un événement ne pollue jamais la sortie d’une action', () => {
    const consoleErreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    offrePubliee(EVENEMENT)
    offreIndisponible(EVENEMENT)

    expect(consoleErreur).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()

    consoleErreur.mockRestore()
    consoleLog.mockRestore()
  })

  it('charge utile inattendue : aucun throw côté hook (contrat no-throw)', () => {
    expect(() =>
      offrePubliee({ offreId: Number.NaN }),
    ).not.toThrow()
    expect(() => offreIndisponible({} as { offreId: number })).not.toThrow()
  })
})
