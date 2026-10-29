import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activerCompteAdmin } from './admin-activation'
import { genererCodeTotp, genererSecretTotp } from '@/lib/admin-crypto'

// ─── Activation d'un compte admin (M10) ─────────────────────────────────────
//
// L'activation est la seule voie d'ouverture d'un compte créé par la CLI :
// mot de passe fort, TOTP vérifié sur le secret affiché, invitation consommée
// et audit dans la MÊME transaction. Un échec de concurrence ne laisse ni
// compte actif ni invitation consommée.

const {
  chargerInvitationMock,
  transactionMock,
  invitationUpdateManyMock,
  userUpdateManyMock,
  recoveryDeleteManyMock,
  recoveryCreateManyMock,
  auditMock,
  bcryptHashMock,
} = vi.hoisted(() => {
  const invitationUpdateManyMock = vi.fn()
  const userUpdateManyMock = vi.fn()
  const recoveryDeleteManyMock = vi.fn()
  const recoveryCreateManyMock = vi.fn()
  const auditMock = vi.fn()
  const tx = {
    adminInvitation: { updateMany: invitationUpdateManyMock },
    user: { updateMany: userUpdateManyMock },
    adminRecoveryCode: {
      deleteMany: recoveryDeleteManyMock,
      createMany: recoveryCreateManyMock,
    },
  }
  return {
    chargerInvitationMock: vi.fn(),
    transactionMock: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    invitationUpdateManyMock,
    userUpdateManyMock,
    recoveryDeleteManyMock,
    recoveryCreateManyMock,
    auditMock,
    bcryptHashMock: vi.fn(async () => 'hash-bcrypt'),
  }
})

vi.mock('@/lib/admin-invitations', () => ({
  chargerInvitationAdmin: chargerInvitationMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: transactionMock },
}))
vi.mock('@/lib/journal-audit', () => ({
  consignerAudit: auditMock,
}))
vi.mock('bcryptjs', () => ({
  default: { hash: bcryptHashMock },
}))

const CLE = Buffer.alloc(32, 7).toString('base64')
process.env.ADMIN_2FA_KEY = CLE

function formulaire(secret: string, code: string): FormData {
  const formData = new FormData()
  formData.set('token', 'jeton-activation-1234567890')
  formData.set('secret', secret)
  formData.set('password', 'MotDePasseAdmin123')
  formData.set('confirmPassword', 'MotDePasseAdmin123')
  formData.set('code', code)
  return formData
}

const INVITATION = {
  id: 5,
  expiresAt: new Date(Date.now() + 60_000),
  user: {
    id: 9,
    name: 'Ada Admin',
    email: 'ada@example.cm',
    isActive: false,
    aMotDePasse: false,
    totpEnabledAt: null,
  },
}

describe('activerCompteAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_2FA_KEY = CLE
    chargerInvitationMock.mockResolvedValue(INVITATION)
    invitationUpdateManyMock.mockResolvedValue({ count: 1 })
    userUpdateManyMock.mockResolvedValue({ count: 1 })
    recoveryDeleteManyMock.mockResolvedValue({ count: 0 })
    recoveryCreateManyMock.mockResolvedValue({ count: 10 })
    auditMock.mockResolvedValue(undefined)
  })

  it('active le compte, stocke le TOTP chiffré et retourne 10 codes une seule fois', async () => {
    const secret = genererSecretTotp()
    const resultat = await activerCompteAdmin({}, formulaire(secret, genererCodeTotp(secret)))

    expect(resultat.recoveryCodes).toHaveLength(10)
    expect(new Set(resultat.recoveryCodes).size).toBe(10)
    expect(resultat.message).toContain('Compte activé')

    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 5, usedAt: null }),
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    )
    expect(userUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 9, role: 'admin', totpEnabledAt: null }),
        data: expect.objectContaining({
          password: 'hash-bcrypt',
          isActive: true,
          totpEnabledAt: expect.any(Date),
          sessionVersion: { increment: 1 },
        }),
      }),
    )
    const donnees = userUpdateManyMock.mock.calls[0]?.[0].data
    expect(donnees.totpSecret).toMatch(/^v1:/)
    expect(JSON.stringify(donnees)).not.toContain(secret)
    expect(recoveryCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: 9, codeHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      ]),
    })
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: 9,
        action: 'activation_admin',
        cibleType: 'admin',
        cibleId: 9,
      }),
    )
  })

  it('refuse un code TOTP qui ne correspond pas au secret affiché', async () => {
    const secret = genererSecretTotp()
    const resultat = await activerCompteAdmin({}, formulaire(secret, '000000'))

    expect(resultat.errors?.code?.[0]).toContain('ne correspond pas')
    expect(transactionMock).not.toHaveBeenCalled()
    expect(recoveryCreateManyMock).not.toHaveBeenCalled()
  })

  it('refuse un mot de passe faible avant toute lecture d’invitation', async () => {
    const formData = formulaire(genererSecretTotp(), '123456')
    formData.set('password', 'faible')

    const resultat = await activerCompteAdmin({}, formData)

    expect(resultat.errors?.password?.[0]).toContain('12 caractères')
    expect(chargerInvitationMock).not.toHaveBeenCalled()
  })

  it('refuse un lien invalide, expiré ou déjà consommé', async () => {
    chargerInvitationMock.mockResolvedValue(null)
    const resultat = await activerCompteAdmin({}, formulaire(genererSecretTotp(), '123456'))

    expect(resultat.message).toContain('invalide, expiré ou déjà utilisé')
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('échec de concurrence : aucun code retourné et message explicite', async () => {
    invitationUpdateManyMock.mockResolvedValue({ count: 0 })
    const secret = genererSecretTotp()

    const resultat = await activerCompteAdmin({}, formulaire(secret, genererCodeTotp(secret)))

    expect(resultat.recoveryCodes).toBeUndefined()
    expect(resultat.message).toContain("vient d'être utilisé ou a expiré")
    expect(userUpdateManyMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('refuse un second facteur valide mais une mise à jour utilisateur concurrente', async () => {
    userUpdateManyMock.mockResolvedValue({ count: 0 })
    const secret = genererSecretTotp()

    const resultat = await activerCompteAdmin({}, formulaire(secret, genererCodeTotp(secret)))

    expect(resultat.recoveryCodes).toBeUndefined()
    expect(recoveryCreateManyMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
