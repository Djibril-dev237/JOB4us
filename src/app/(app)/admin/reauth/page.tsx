import type { Metadata } from 'next'

import { requireAdmin } from '@/lib/dal'
import { redirectionInterne } from '@/lib/redirect'

import { ReauthAdminForm } from './reauth-admin-form'

export const metadata: Metadata = {
  title: 'Réauthentification',
  robots: { index: false, follow: false },
}

export default async function ReauthAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const params = await searchParams
  const brut = typeof params.retour === 'string' ? params.retour : null
  const retour = brut ? redirectionInterne(brut) : null
  const cible = retour && retour.startsWith('/admin/') ? retour : '/admin/dashboard'

  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <ReauthAdminForm retour={cible} />
    </div>
  )
}
