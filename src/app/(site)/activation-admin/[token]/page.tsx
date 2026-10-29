import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { chargerInvitationAdmin } from '@/lib/admin-invitations'
import { genererSecretTotp } from '@/lib/admin-crypto'

import { ActivationAdminForm } from './activation-admin-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activation administrateur',
  robots: { index: false, follow: false },
}

export default async function ActivationAdminPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invitation = await chargerInvitationAdmin(token)
  if (!invitation) notFound()

  const secret = genererSecretTotp()
  const compte = invitation.user.email ?? invitation.user.name
  const otpauthUri = `otpauth://totp/${encodeURIComponent(`Job4Us:${compte}`)}?secret=${secret}&issuer=Job4Us&algorithm=SHA1&digits=6&period=30`

  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <ActivationAdminForm
        token={token}
        secret={secret}
        otpauthUri={otpauthUri}
        nom={invitation.user.name}
        email={invitation.user.email}
      />
    </div>
  )
}
