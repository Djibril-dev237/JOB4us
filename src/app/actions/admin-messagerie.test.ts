import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deciderSignalement,
  ouvrirConversationSignalement,
  retablirMessage,
} from './admin-messagerie'

// ─── Tests des actions de modération M10 ─────────────────────────────────────
//
// Critères verrouillés :
//  1. `requireAdmin()` est la PREMIÈRE instruction : un non-admin ne déclenche
//     aucune lecture, aucune écriture, aucun cookie ;
//  2. toute action sensible exige la réauthentification de 5 minutes ;
//  3. la consultation privée écrit l'audit AVANT de délivrer le grant ;
//  4. la décision est un CAS `statut: ouvert`, le masquage est append-only et
//     la suspension incrémente `sessionVersion` ;
//  5. aucune donnée privée (contenu, note, identité) n'entre dans les logs.
// ---------------------------------------------------------------------------

interface ArgsSignalementFindUnique {
  where?: { id: number }
  select?: unknown
}

interface ArgsUpdateMany {
  where?: Record<string, unknown>
  data?: Record<string, unknown>
}

interface ArgsModerationCreate {
  data: Record<string, unknown>
}

const {
  requireAdminMock,
  reauthMock,
  accesMock,
  auditMock,
  notifierMock,
  cookieSetMock,
  signalementFindUnique,
  messageFindUnique,
  moderationFindFirst,
  transactionMock,
  txSignalementUpdateMany,
  txModerationCreate,
  txUserUpdateMany,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  reauthMock: vi.fn(),
  accesMock: vi.fn(),
  auditMock: vi.fn(),
  notifierMock: vi.fn(),
  cookieSetMock: vi.fn(),
  signalementFindUnique: vi.fn<(args: ArgsSignalementFindUnique) => Promise<unknown>>(),
  messageFindUnique: vi.fn<(args: { where?: { id: number }; select?: unknown }) => Promise<unknown>>(),
  moderationFindFirst: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
  transactionMock: vi.fn(),
  txSignalementUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
  txModerationCreate: vi.fn<(args: ArgsModerationCreate) => Promise<unknown>>(),
  txUserUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
}))

vi.mock('@/lib/dal', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/admin-reauth', () => ({
  reauthAdminValide: reauthMock,
  accesSignalementValide: accesMock,
}))
vi.mock('@/lib/journal-audit', () => ({ consignerAudit: auditMock }))
vi.mock('@/lib/notifications-evenements', () => ({
  notifierDecisionModeration: notifierMock,
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock })),
}))
vi.mock('@/lib/admin-crypto', () => ({
  ADMIN_ACCES_SIGNALEMENT_TTL_MS: 300_000,
  creerJetonAccesSignalement: vi.fn(() => 'jeton-signalement'),
  nomCookieAccesSignalement: vi.fn((id: number) => `acces_signalement_${id}`),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    signalement: { findUnique: signalementFindUnique },
    message: { findUnique: messageFindUnique },
    messageModeration: { findFirst: moderationFindFirst },
    $transaction: transactionMock,
  },
}))

const ADMIN_ID = 42
const SIGNALEMENT_ID = 7
const MESSAGE_ID = 99
const SENDER_ID = 11

const RAPPORT_OUVERT = {
  id: SIGNALEMENT_ID,
  statut: 'ouvert',
  auteurId: 5,
  messageId: MESSAGE_ID,
  message: {
    senderId: SENDER_ID,
    sender: { id: SENDER_ID, role: 'recruteur' },
  },
}

function payloadDecision(decision: string, motif = 'spam') {
  return { signalementId: SIGNALEMENT_ID, decision, motif, noteInterne: 'note interne' }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue({ userId: ADMIN_ID, role: 'admin' })
  reauthMock.mockResolvedValue(true)
  accesMock.mockResolvedValue(true)
  auditMock.mockResolvedValue(undefined)
  notifierMock.mockResolvedValue(undefined)
  signalementFindUnique.mockResolvedValue(RAPPORT_OUVERT)
  messageFindUnique.mockResolvedValue({ id: MESSAGE_ID })
  moderationFindFirst.mockResolvedValue({ action: 'masquage' })
  txSignalementUpdateMany.mockResolvedValue({ count: 1 })
  txModerationCreate.mockResolvedValue({ id: 1 })
  txUserUpdateMany.mockResolvedValue({ count: 1 })
  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      signalement: { updateMany: txSignalementUpdateMany },
      messageModeration: { create: txModerationCreate },
      user: { updateMany: txUserUpdateMany },
    }),
  )
})

describe('ouvrirConversationSignalement (motif + réauth + audit avant lecture)', () => {
  it('non-admin : requireAdmin jette avant toute lecture et tout cookie', async () => {
    requireAdminMock.mockRejectedValue(new Error('NEXT_NOT_FOUND'))

    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'enquete' }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(signalementFindUnique).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
  })

  it('sans réauthentification : refus, zéro lecture et zéro cookie', async () => {
    reauthMock.mockResolvedValue(false)

    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'enquete' }),
    ).resolves.toEqual({ ok: false, erreur: 'reauth' })

    expect(signalementFindUnique).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
  })

  it('motif hors catalogue : inconnue, zéro lecture', async () => {
    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'motif-libre' }),
    ).resolves.toEqual({ ok: false, erreur: 'inconnue' })

    expect(signalementFindUnique).not.toHaveBeenCalled()
  })

  it('signalement absent : inconnue, zéro audit et zéro cookie', async () => {
    signalementFindUnique.mockResolvedValue(null)

    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'enquete' }),
    ).resolves.toEqual({ ok: false, erreur: 'inconnue' })

    expect(auditMock).not.toHaveBeenCalled()
    expect(cookieSetMock).not.toHaveBeenCalled()
  })

  it('audit AVANT cookie, puis grant lié à l’admin et au signalement', async () => {
    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'enquete' }),
    ).resolves.toEqual({ ok: true })

    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: ADMIN_ID,
        action: 'consultation_conversation',
        cibleType: 'signalement',
        cibleId: SIGNALEMENT_ID,
        motif: 'enquete',
      }),
    )
    expect(auditMock.mock.invocationCallOrder[0]).toBeLessThan(
      cookieSetMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(cookieSetMock).toHaveBeenCalledWith(
      `acces_signalement_${SIGNALEMENT_ID}`,
      'jeton-signalement',
      expect.objectContaining({ httpOnly: true, maxAge: 300 }),
    )
  })

  it('échec d’audit : aucun cookie, verdict inconnue', async () => {
    auditMock.mockRejectedValue(new Error('DB down'))

    await expect(
      ouvrirConversationSignalement({ signalementId: SIGNALEMENT_ID, motif: 'enquete' }),
    ).resolves.toEqual({ ok: false, erreur: 'inconnue' })

    expect(cookieSetMock).not.toHaveBeenCalled()
  })
})

describe('deciderSignalement (réauth + grant + CAS + effets append-only)', () => {
  it('sans réauthentification : refus avant toute lecture', async () => {
    reauthMock.mockResolvedValue(false)

    await expect(deciderSignalement(payloadDecision('sans_suite'))).resolves.toEqual({
      ok: false,
      erreur: 'reauth',
    })

    expect(signalementFindUnique).not.toHaveBeenCalled()
  })

  it('sans grant de signalement : interdit, aucune décision possible', async () => {
    accesMock.mockResolvedValue(false)

    await expect(deciderSignalement(payloadDecision('sans_suite'))).resolves.toEqual({
      ok: false,
      erreur: 'interdit',
    })

    expect(signalementFindUnique).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('décision hors catalogue : inconnue, zéro lecture', async () => {
    await expect(deciderSignalement(payloadDecision('suppression'))).resolves.toEqual({
      ok: false,
      erreur: 'inconnue',
    })

    expect(signalementFindUnique).not.toHaveBeenCalled()
  })

  it('signalement déjà traité : deja true, aucune transaction', async () => {
    signalementFindUnique.mockResolvedValue({ ...RAPPORT_OUVERT, statut: 'traite' })

    await expect(deciderSignalement(payloadDecision('sans_suite'))).resolves.toEqual({
      ok: true,
      deja: true,
      decision: 'sans_suite',
    })

    expect(transactionMock).not.toHaveBeenCalled()
    expect(notifierMock).not.toHaveBeenCalled()
  })

  it('suspension d’un admin : interdit avant la transaction', async () => {
    signalementFindUnique.mockResolvedValue({
      ...RAPPORT_OUVERT,
      message: { senderId: 1, sender: { id: 1, role: 'admin' } },
    })

    await expect(deciderSignalement(payloadDecision('suspension'))).resolves.toEqual({
      ok: false,
      erreur: 'interdit',
    })

    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('masquage : CAS statut ouvert, ligne append-only et deux audits', async () => {
    await expect(deciderSignalement(payloadDecision('masquage'))).resolves.toEqual({
      ok: true,
      deja: false,
      decision: 'masquage',
    })

    expect(txSignalementUpdateMany).toHaveBeenCalledWith({
      where: { id: SIGNALEMENT_ID, statut: 'ouvert' },
      data: expect.objectContaining({
        statut: 'traite',
        decision: 'masquage',
        motifDecision: 'spam',
        traiteParId: ADMIN_ID,
      }),
    })
    expect(txModerationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: MESSAGE_ID,
        signalementId: SIGNALEMENT_ID,
        acteurId: ADMIN_ID,
        action: 'masquage',
        motif: 'spam',
      }),
    })
    expect(txUserUpdateMany).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'decision_signalement', cibleId: SIGNALEMENT_ID }),
    )
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'masquage_message', cibleId: MESSAGE_ID }),
    )
    expect(notifierMock).toHaveBeenCalledWith({
      signalementId: SIGNALEMENT_ID,
      auteurId: 5,
      decision: 'masquage',
    })
  })

  it('suspension : masque ET suspend le compte avec sessionVersion incrémenté', async () => {
    await expect(deciderSignalement(payloadDecision('suspension', 'harcelement'))).resolves.toEqual({
      ok: true,
      deja: false,
      decision: 'suspension',
    })

    expect(txModerationCreate).toHaveBeenCalled()
    expect(txUserUpdateMany).toHaveBeenCalledWith({
      where: { id: SENDER_ID, role: { not: 'admin' } },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    })
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'suspension_utilisateur', cibleId: SENDER_ID }),
    )
  })

  it('sans suite : aucun masquage, aucune suspension, notification de décision', async () => {
    await expect(deciderSignalement(payloadDecision('sans_suite'))).resolves.toEqual({
      ok: true,
      deja: false,
      decision: 'sans_suite',
    })

    expect(txModerationCreate).not.toHaveBeenCalled()
    expect(txUserUpdateMany).not.toHaveBeenCalled()
    expect(notifierMock).toHaveBeenCalledTimes(1)
  })

  it('CAS perdu : deja true, aucune notification', async () => {
    txSignalementUpdateMany.mockResolvedValue({ count: 0 })

    await expect(deciderSignalement(payloadDecision('masquage'))).resolves.toEqual({
      ok: true,
      deja: true,
      decision: 'masquage',
    })

    expect(txModerationCreate).not.toHaveBeenCalled()
    expect(notifierMock).not.toHaveBeenCalled()
  })
})

describe('retablirMessage (append-only + audit)', () => {
  it('sans réauthentification : refus avant lecture', async () => {
    reauthMock.mockResolvedValue(false)

    await expect(
      retablirMessage({ messageId: MESSAGE_ID, motif: 'recours_fonde' }),
    ).resolves.toEqual({ ok: false, erreur: 'reauth' })

    expect(messageFindUnique).not.toHaveBeenCalled()
  })

  it('message absent : inconnue', async () => {
    messageFindUnique.mockResolvedValue(null)

    await expect(
      retablirMessage({ messageId: MESSAGE_ID, motif: 'recours_fonde' }),
    ).resolves.toEqual({ ok: false, erreur: 'inconnue' })
  })

  it('message déjà rétabli : deja true, aucune écriture', async () => {
    moderationFindFirst.mockResolvedValue({ action: 'retablissement' })

    await expect(
      retablirMessage({ messageId: MESSAGE_ID, motif: 'recours_fonde' }),
    ).resolves.toEqual({ ok: true, deja: true })

    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('message masqué : audit puis ligne retablissement', async () => {
    await expect(
      retablirMessage({ messageId: MESSAGE_ID, motif: 'recours_fonde' }),
    ).resolves.toEqual({ ok: true, deja: false })

    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'retablissement_message',
        cibleType: 'message',
        cibleId: MESSAGE_ID,
        motif: 'recours_fonde',
      }),
    )
    expect(txModerationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: MESSAGE_ID,
        acteurId: ADMIN_ID,
        action: 'retablissement',
        motif: 'recours_fonde',
      }),
    })
  })
})
