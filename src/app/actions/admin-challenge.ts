'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { COOKIE_CHALLENGE_ADMIN } from '@/lib/admin-crypto'

/** Abandonne le challenge en cours et revient au formulaire de connexion. */
export async function annulerChallengeAdmin(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_CHALLENGE_ADMIN)
  redirect('/login')
}
