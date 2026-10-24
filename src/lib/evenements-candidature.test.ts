import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  candidatureEnvoyee,
  candidatureRetiree,
  statutChange,
  type EvenementCandidature,
  type EvenementStatutChange,
} from '@/lib/evenements-candidature'
import { conversationCreee } from '@/lib/evenements-messagerie'
import {
  notifierCandidatureRecue,
  notifierCandidatureRetiree,
  notifierStatutChange,
} from '@/lib/notifications-evenements'
import { creerConversationDepuisCandidature } from '@/lib/messagerie-creation'

// ─── Branchements M8 + M9 dans les hooks de candidature (Vague 2) ───────────
//
// Verrou du POINT DE BRANCHEMENT : la conversation-cadre doit naître au
// moment exact de l'envoi (M8), la notification « Nouvelle candidature »
// doit partir INDEPENDAMMENT du succès de cette conversation (arbitrage M9),
// et surtout le CONTRAT du module (jamais d'exception, jamais de log) doit
// survivre à un échec de base — les actions M7 ne peuvent pas voir leur
// verdict modifié par un événement.
// ---------------------------------------------------------------------------

vi.mock('@/lib/messagerie-creation', () => ({
  creerConversationDepuisCandidature: vi.fn(),
}))
vi.mock('@/lib/evenements-messagerie', () => ({
  conversationCreee: vi.fn(),
}))
vi.mock('@/lib/notifications-evenements', () => ({
  notifierCandidatureRecue: vi.fn(async () => undefined),
  notifierCandidatureRetiree: vi.fn(async () => undefined),
  notifierStatutChange: vi.fn(async () => undefined),
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
const recue = vi.mocked(notifierCandidatureRecue)
const retiree = vi.mocked(notifierCandidatureRetiree)
const statut = vi.mocked(notifierStatutChange)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('candidatureEnvoyee — branchements M8 + M9', () => {
  it('crée la conversation, émet conversationCreee, et notifie le recruteur UNE fois', async () => {
    creer.mockResolvedValue(7)

    candidatureEnvoyee(EVENEMENT)
    await laisserTourner()

    expect(creer).toHaveBeenCalledTimes(1)
    expect(creer).toHaveBeenCalledWith(21)
    expect(notifiee).toHaveBeenCalledTimes(1)
    expect(notifiee).toHaveBeenCalledWith({ conversationId: 7, candidatureId: 21 })
    expect(recue).toHaveBeenCalledTimes(1)
    expect(recue).toHaveBeenCalledWith(EVENEMENT)
  })

  it('ARBITRAGE M9 : la notification recruteur part MÊME si la conversation échoue (null)', async () => {
    // « Un candidat a postulé » reste vrai sans conversation : lier la
    // notification au succès de la messagerie serait un couplage fautif.
    creer.mockResolvedValue(null)

    candidatureEnvoyee(EVENEMENT)
    await laisserTourner()

    expect(recue).toHaveBeenCalledTimes(1)
    expect(notifiee).not.toHaveBeenCalled()
  })

  it('DB indisponible : la promesse avalée ne propage JAMAIS (contrat no-throw)', async () => {
    creer.mockRejectedValue(new Error('base en panne'))

    // Aucun `.catch` côté appelant possible : si l'événement fuyait, le test
    // finirait en rejection non gérée et échouerait.
    expect(() => candidatureEnvoyee(EVENEMENT)).not.toThrow()
    await laisserTourner()

    expect(notifiee).not.toHaveBeenCalled()
    // La notification recruteur est indépendante : elle part quand même.
    expect(recue).toHaveBeenCalledTimes(1)
  })
})

describe('hooks statutChange / candidatureRetiree — branchement M9', () => {
  it('statutChange délègue le payload EXACT au résolveur (candidat notifié)', () => {
    const evenementStatut: EvenementStatutChange = {
      ...EVENEMENT,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
      acteurId: 3,
    }
    expect(statutChange(evenementStatut)).toBeUndefined()

    expect(statut).toHaveBeenCalledTimes(1)
    expect(statut).toHaveBeenCalledWith(evenementStatut)
    expect(creer).not.toHaveBeenCalled()
  })

  it('candidatureRetiree délègue le payload EXACT au résolveur (recruteur notifié)', () => {
    expect(candidatureRetiree(EVENEMENT)).toBeUndefined()

    expect(retiree).toHaveBeenCalledTimes(1)
    expect(retiree).toHaveBeenCalledWith(EVENEMENT)
    expect(creer).not.toHaveBeenCalled()
    expect(notifiee).not.toHaveBeenCalled()
  })
})
