import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  conversationCreee,
  messageEnvoye,
  messageLu,
  signalementRecu,
  type EvenementConversationCreee,
  type EvenementMessageEnvoye,
  type EvenementMessageLu,
  type EvenementSignalementRecu,
} from '@/lib/evenements-messagerie'
import {
  notifierMessageEnvoye,
  notifierSignalementRecu,
} from '@/lib/notifications-evenements'

// ─── Contrat des hooks de messagerie (M9 BRANCHÉ + 2 no-op arbitrés) ────────
//
// Verrou du POINT DE BRANCHEMENT M8/M9 : `messageEnvoye` et
// `signalementRecu` délèguent au résolveur M9 avec le payload EXACT (le
// hook ne lit aucun champ, ne relit jamais la base), tandis que
// `conversationCreee` et `messageLu` restent no-op DOCUMENTÉS (arbitrages
// en tête du module : la notification recruteur vit dans candidatureRecue,
// un acquittement de lecture n'est pas une notification). Contrat module :
// toujours `void`, jamais d'exception, jamais de log.
// ---------------------------------------------------------------------------

vi.mock('@/lib/notifications-evenements', () => ({
  notifierMessageEnvoye: vi.fn(async () => undefined),
  notifierSignalementRecu: vi.fn(async () => undefined),
}))

const notifierMessage = vi.mocked(notifierMessageEnvoye)
const notifierSignalement = vi.mocked(notifierSignalementRecu)

const MESSAGE: EvenementMessageEnvoye = {
  conversationId: 7,
  messageId: 9,
  emetteurId: 10,
}
const SIGNALEMENT: EvenementSignalementRecu = { messageId: 9, auteurId: 10 }
const CONVERSATION: EvenementConversationCreee = { conversationId: 7, candidatureId: 21 }
const LU: EvenementMessageLu = { conversationId: 7, lecteurId: 10 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('messageEnvoye — branchement M9', () => {
  it('délègue le payload EXACT au résolveur et retourne void', () => {
    expect(messageEnvoye(MESSAGE)).toBeUndefined()

    expect(notifierMessage).toHaveBeenCalledTimes(1)
    expect(notifierMessage).toHaveBeenCalledWith(MESSAGE)
  })
})

describe('signalementRecu — branchement M9', () => {
  it('délègue le payload EXACT au résolveur et retourne void', () => {
    expect(signalementRecu(SIGNALEMENT)).toBeUndefined()

    expect(notifierSignalement).toHaveBeenCalledTimes(1)
    expect(notifierSignalement).toHaveBeenCalledWith(SIGNALEMENT)
  })
})

describe('conversationCreee / messageLu — no-op arbitrés (M9)', () => {
  it('aucun résolveur appelé, aucun log, aucun throw', () => {
    const consoleErreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(conversationCreee(CONVERSATION)).toBeUndefined()
    expect(messageLu(LU)).toBeUndefined()

    expect(notifierMessage).not.toHaveBeenCalled()
    expect(notifierSignalement).not.toHaveBeenCalled()
    expect(consoleErreur).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()

    consoleErreur.mockRestore()
    consoleLog.mockRestore()
  })
})
