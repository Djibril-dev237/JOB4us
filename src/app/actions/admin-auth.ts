'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { CredentialsSignin } from 'next-auth'

import { signIn } from '@/auth'
import { lireChallengeAdmin, verifierCodeAdminPourSession } from '@/lib/admin-auth'
import {
  ADMIN_REAUTH_TTL_MS,
  COOKIE_CHALLENGE_ADMIN,
  COOKIE_REAUTH_ADMIN,
  creerJetonReauth,
} from '@/lib/admin-crypto'
import { requireAdmin } from '@/lib/dal'
import { consignerAudit } from '@/lib/journal-audit'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, recordAttempt, resetAttempts } from '@/lib/rate-limit'
import { redirectionInterne } from '@/lib/redirect'

// ─── Second facteur de connexion admin (M10) ────────────────────────────────
//
// Le formulaire ne reçoit jamais le jeton de challenge : il vit dans un cookie
// httpOnly de 5 minutes. L'action serveur le lit, le passe au provider
// `admin-challenge`, puis efface le cookie. Le code TOTP est vérifié par
// l'authorize() du provider (source unique, y compris pour un POST direct).
// ---------------------------------------------------------------------------

export interface Admin2faFormState {
  message?: string
  errors?: { code?: string[] }
}

export async function entrerCodeAdmin(
  _prevState: Admin2faFormState,
  formData: FormData,
): Promise<Admin2faFormState> {
  const cookieStore = await cookies()
  const challengeToken = cookieStore.get(COOKIE_CHALLENGE_ADMIN)?.value
  const code = formData.get('code')
  const codeTexte = typeof code === 'string' ? code.trim() : ''

  if (!challengeToken) {
    redirect('/login?error=1')
  }
  if (codeTexte.length < 6 || codeTexte.length > 32) {
    return { errors: { code: ["Saisissez le code à 6 chiffres ou un code de récupération."] } }
  }

  const challenge = await lireChallengeAdmin(challengeToken)
  if (!challenge) {
    cookieStore.delete(COOKIE_CHALLENGE_ADMIN)
    redirect('/login?error=1')
  }

  try {
    await signIn('admin-challenge', {
      challengeToken,
      code: codeTexte,
      redirect: false,
    })
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return { message: 'Code invalide ou expiré.' }
    }
    throw error
  }

  // Le second facteur vient d'être validé : la fenêtre de réauthentification
  // de 5 minutes couvre les actions sensibles qui suivent immédiatement.
  cookieStore.set(COOKIE_REAUTH_ADMIN, creerJetonReauth(challenge.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ADMIN_REAUTH_TTL_MS / 1000),
  })
  cookieStore.delete(COOKIE_CHALLENGE_ADMIN)

  // Trace immuable de l'ouverture de session admin. En cas d'échec de
  // l'audit, l'action échoue : jamais de session sensible non tracée.
  await consignerAudit(prisma, {
    acteurId: challenge.userId,
    action: 'connexion_admin',
    cibleType: 'admin',
    cibleId: challenge.userId,
  })

  redirect('/admin/dashboard')
}

// ─── Réauthentification pour action sensible ────────────────────────────────

export interface ReauthAdminFormState {
  message?: string
}

export async function reauthentifierAdmin(
  _prevState: ReauthAdminFormState,
  formData: FormData,
): Promise<ReauthAdminFormState> {
  const session = await requireAdmin()
  const code = formData.get('code')
  const codeTexte = typeof code === 'string' ? code.trim() : ''
  const cle = `admin:reauth:${session.userId}`
  const limite = checkRateLimit(cle, 5, 5 * 60 * 1000)
  if (!limite.allowed) {
    return { message: 'Trop de tentatives. Réessayez dans quelques minutes.' }
  }
  if (!codeTexte) {
    return { message: "Saisissez un code d'authentification." }
  }

  const valide = await verifierCodeAdminPourSession(session.userId, codeTexte)
  if (!valide) {
    recordAttempt(cle)
    return { message: 'Code invalide ou expiré.' }
  }
  resetAttempts(cle)

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_REAUTH_ADMIN, creerJetonReauth(session.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ADMIN_REAUTH_TTL_MS / 1000),
  })

  await consignerAudit(prisma, {
    acteurId: session.userId,
    action: 'reauthentification_admin',
    cibleType: 'admin',
    cibleId: session.userId,
  })

  const retourBrut = formData.get('retour')
  const retour =
    typeof retourBrut === 'string' ? redirectionInterne(retourBrut) : null
  redirect(retour && retour.startsWith('/admin/') ? retour : '/admin/dashboard')
}
