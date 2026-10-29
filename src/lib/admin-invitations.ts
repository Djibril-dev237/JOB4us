import 'server-only'

import { hacherJeton } from '@/lib/admin-crypto'
import { prisma } from '@/lib/prisma'

// ─── Lecture d'une invitation admin (M10) ────────────────────────────────────
//
// Une invitation est un jeton de 32 octets, stocké HACHÉ. La page d'activation
// et l'action relisent la même projection : jamais de hash de mot de passe,
// juste un booléen `aMotDePasse` pour distinguer un nouveau compte d'une
// reprise d'un admin existant sans TOTP.
// ---------------------------------------------------------------------------

export interface InvitationAdminLisible {
  id: number
  expiresAt: Date
  user: {
    id: number
    name: string
    email: string | null
    isActive: boolean
    aMotDePasse: boolean
    totpEnabledAt: Date | null
  }
}

/**
 * Valide une invitation : non utilisée, non expirée, compte admin non
 * anonymisé et TOTP pas encore activé. Un compte existant suspendu (mot de
 * passe présent mais isActive=false) est refusé : la reprise ne réactive pas
 * un compte suspendu.
 */
export async function chargerInvitationAdmin(
  token: string | null | undefined,
): Promise<InvitationAdminLisible | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return null

  const invitation = await prisma.adminInvitation.findUnique({
    where: { tokenHash: hacherJeton(token) },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          password: true,
          totpEnabledAt: true,
          anonymizedAt: true,
        },
      },
    },
  })

  if (
    !invitation ||
    invitation.usedAt !== null ||
    invitation.expiresAt.getTime() <= Date.now() ||
    invitation.user.role !== 'admin' ||
    invitation.user.anonymizedAt !== null ||
    invitation.user.totpEnabledAt !== null
  ) {
    return null
  }

  const aMotDePasse = invitation.user.password !== null
  if (!invitation.user.isActive && aMotDePasse) return null

  return {
    id: invitation.id,
    expiresAt: invitation.expiresAt,
    user: {
      id: invitation.user.id,
      name: invitation.user.name,
      email: invitation.user.email,
      isActive: invitation.user.isActive,
      aMotDePasse,
      totpEnabledAt: invitation.user.totpEnabledAt,
    },
  }
}
