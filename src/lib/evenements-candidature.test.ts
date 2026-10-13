import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  candidatureEnvoyee,
  candidatureRetiree,
  statutChange,
  type EvenementCandidature,
} from '@/lib/evenements-candidature'
import { conversationCreee } from '@/lib/evenements-messagerie'
import { creerConversationDepuisCandidature } from '@/lib/messagerie-creation'

// ─── Branchement M8 dans `candidatureEnvoyee` (Vague 2) ──────────────────────
//
// Verrou du POINT DE BRANCHEMENT : la conversation-cadre doit naître au
// moment exact de l'envoi, l'événement M9 doit ne partir qu'une fois par
// création réelle, et surtout le CONTRAT du module (jamais d'exception,
// jamais de log) doit survivre à un échec de base — les actions M7 ne
// peuvent pas voir leur verdict modifié par un événement.
// ---------------------------------------------------------------------------

vi.mock('@/lib/messagerie-creation', () => ({
  creerConversationDepuisCandidature: vi.fn(),
}))
vi.mock('@/lib/evenements-messagerie', () => ({
  conversationCreee: vi.fn(),
}))

const EVENEMENT: EvenementCandidature = {
  candidatureId: 21,
  offreId: 30,
  candidatId: 42,
}

/** Laisse tourner les micro/macro-tâches de la chaîne fire-and-forget. */
async function laisserTourner(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const creer = vi.mocked(creerConversationDepuisCandidature)
const notifiee = vi.mocked(conversationCreee)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('candidatureEnvoyee — branchement M8', () => {
  it('crée la conversation depuis la candidature et émet conversationCreee une fois', async () => {
    creer.mockResolvedValue(7)

    candidatureEnvoyee(EVENEMENT)
    await laisserTourner()

    expect(creer).toHaveBeenCalledTimes(1)
    expect(creer).toHaveBeenCalledWith(21)
    expect(notifiee).toHaveBeenCalledTimes(1)
    expect(notifiee).toHaveBeenCalledWith({ conversationId: 7, candidatureId: 21 })
  })

  it("candidature absente (null) : pas d'événement, pas d'exception", async () => {
    creer.mockResolvedValue(null)

    candidatureEnvoyee(EVENEMENT)
    await laisserTourner()

    expect(notifiee).not.toHaveBeenCalled()
  })

  it('DB indisponible : la promesse avalée ne propage JAMAIS (contrat no-throw)', async () => {
    creer.mockRejectedValue(new Error('base en panne'))

    // Aucun `.catch` côté appelant possible : si l'événement fuyait, le test
    // finirait en rejection non gérée et échouerait.
    expect(() => candidatureEnvoyee(EVENEMENT)).not.toThrow()
    await laisserTourner()

    expect(notifiee).not.toHaveBeenCalled()
  })
})

describe('les autres hooks restent no-op (M9, non branchés)', () => {
  it('candidatureRetiree et statutChange ne touchent ni la création ni les événements', async () => {
    candidatureRetiree(EVENEMENT)
    statutChange({
      ...EVENEMENT,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
      acteurId: 3,
    })
    await laisserTourner()

    expect(creer).not.toHaveBeenCalled()
    expect(notifiee).not.toHaveBeenCalled()
  })
})
