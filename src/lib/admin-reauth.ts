import 'server-only'

import { cookies } from 'next/headers'

import {
  COOKIE_REAUTH_ADMIN,
  nomCookieAccesSignalement,
  verifierJetonAccesSignalement,
  verifierJetonReauth,
} from '@/lib/admin-crypto'

// ─── Grants courts des actions admin (M10) ───────────────────────────────────
//
// La session admin prouve l'identité ; elle ne prouve pas que l'admin est
// devant l'écran au moment d'une action irréversible. Les actions sensibles
// exigent donc un grant de réauthentification de 5 minutes. La consultation
// privée d'une conversation exige en plus un grant lié au signalement.
// ---------------------------------------------------------------------------

export async function reauthAdminValide(adminId: number): Promise<boolean> {
  const cookieStore = await cookies()
  return verifierJetonReauth(cookieStore.get(COOKIE_REAUTH_ADMIN)?.value, adminId)
}

export async function accesSignalementValide(
  adminId: number,
  signalementId: number,
): Promise<boolean> {
  const cookieStore = await cookies()
  return verifierJetonAccesSignalement(
    cookieStore.get(nomCookieAccesSignalement(signalementId))?.value,
    adminId,
    signalementId,
  )
}
