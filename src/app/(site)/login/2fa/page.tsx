import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { lireChallengeAdmin } from '@/lib/admin-auth'
import { COOKIE_CHALLENGE_ADMIN } from '@/lib/admin-crypto'

import { Admin2faForm } from './admin-2fa-form'

export const metadata: Metadata = {
  title: 'Vérification',
  robots: { index: false, follow: false },
}

function masquerEmail(email: string | null): string | null {
  if (!email) return null
  const [local, domaine] = email.split('@')
  if (!local || !domaine) return null
  const premiere = local.slice(0, 1)
  return `${premiere}${'*'.repeat(Math.max(2, local.length - 1))}@${domaine}`
}

export default async function Admin2faPage() {
  const cookieStore = await cookies()
  const challenge = await lireChallengeAdmin(
    cookieStore.get(COOKIE_CHALLENGE_ADMIN)?.value,
  )

  if (!challenge) redirect('/login')

  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <Admin2faForm email={masquerEmail(challenge.user.email)} />
    </div>
  )
}
