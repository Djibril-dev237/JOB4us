'use server'

import bcrypt from 'bcryptjs'

import { chargerInvitationAdmin } from '@/lib/admin-invitations'
import {
  chiffrerSecretTotp,
  genererCodesRecuperation,
  verifierCodeTotp,
} from '@/lib/admin-crypto'
import { ActivationAdminSchema } from '@/lib/admin-schemas'
import { formDataString, issuesToErrors } from '@/lib/form-errors'
import { consignerAudit } from '@/lib/journal-audit'
import { prisma } from '@/lib/prisma'

// ─── Activation d'un compte admin par invitation (M10) ──────────────────────
//
// Le compte est créé par la CLI avec isActive=false et sans mot de passe. La
// page d'activation est la SEULE voie d'ouverture : mot de passe fort, secret
// TOTP affiché une fois, code vérifié, 10 codes de récupération affichés une
// fois. L'invitation est consommée dans la même transaction que l'activation
// et que le journal d'audit.
// ---------------------------------------------------------------------------

export interface ActivationAdminState {
  message?: string
  errors?: Partial<Record<string, string[]>>
  recoveryCodes?: string[]
}

class EchecActivation extends Error {
  constructor() {
    super('activation-admin-echec')
  }
}

export async function activerCompteAdmin(
  _prevState: ActivationAdminState,
  formData: FormData,
): Promise<ActivationAdminState> {
  const parsed = ActivationAdminSchema.safeParse({
    token: formDataString(formData.get('token')),
    secret: formDataString(formData.get('secret')),
    password: formDataString(formData.get('password')),
    confirmPassword: formDataString(formData.get('confirmPassword')),
    code: formDataString(formData.get('code')).trim(),
  })

  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }

  const data = parsed.data
  const invitation = await chargerInvitationAdmin(data.token)
  if (!invitation) {
    return {
      message:
        "Lien d'activation invalide, expiré ou déjà utilisé. Demandez une nouvelle invitation à un administrateur.",
    }
  }

  const verification = verifierCodeTotp(data.secret, data.code, null)
  if (!verification.valide || verification.pas === undefined) {
    return {
      errors: {
        code: [
          "Le code ne correspond pas au secret affiché. Vérifiez l'heure de votre appareil et réessayez.",
        ],
      },
    }
  }

  let secretChiffre: string
  try {
    secretChiffre = chiffrerSecretTotp(data.secret)
  } catch {
    return {
      message:
        "L'activation est momentanément indisponible. Contactez l'administrateur technique.",
    }
  }

  const passwordHash = await bcrypt.hash(data.password, 12)
  const maintenant = new Date()
  const codes = genererCodesRecuperation()

  try {
    await prisma.$transaction(async (tx) => {
      const invitationConsommee = await tx.adminInvitation.updateMany({
        where: {
          id: invitation.id,
          usedAt: null,
          expiresAt: { gt: maintenant },
        },
        data: { usedAt: maintenant },
      })
      if (invitationConsommee.count !== 1) throw new EchecActivation()

      const utilisateurActive = await tx.user.updateMany({
        where: {
          id: invitation.user.id,
          role: 'admin',
          totpEnabledAt: null,
          anonymizedAt: null,
        },
        data: {
          password: passwordHash,
          isActive: true,
          totpSecret: secretChiffre,
          totpEnabledAt: maintenant,
          totpLastStep: verification.pas,
          sessionVersion: { increment: 1 },
        },
      })
      if (utilisateurActive.count !== 1) throw new EchecActivation()

      await tx.adminRecoveryCode.deleteMany({
        where: { userId: invitation.user.id },
      })
      await tx.adminRecoveryCode.createMany({
        data: codes.hashes.map((codeHash) => ({
          userId: invitation.user.id,
          codeHash,
        })),
      })

      await consignerAudit(tx, {
        acteurId: invitation.user.id,
        action: 'activation_admin',
        cibleType: 'admin',
        cibleId: invitation.user.id,
        commentaire: invitation.user.aMotDePasse
          ? "Reprise d'un compte admin existant sans TOTP"
          : "Activation d'un nouveau compte admin",
      })
    })
  } catch (error) {
    if (error instanceof EchecActivation) {
      return {
        message:
          "Ce lien vient d'être utilisé ou a expiré. Si vous n'avez pas reçu vos codes de récupération, demandez une nouvelle invitation.",
      }
    }
    throw error
  }

  return {
    message:
      'Compte activé. Conservez ces codes de récupération : ils ne seront plus jamais affichés.',
    recoveryCodes: codes.codes,
  }
}
