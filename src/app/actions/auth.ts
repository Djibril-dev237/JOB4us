'use server'

import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CredentialsSignin } from 'next-auth'

import { signIn, signOut } from '@/auth'
import { prisma } from '@/lib/prisma'
import {
  LoginSchema,
  RegisterCandidatSchema,
  RegisterRecruteurSchema,
  type FormState,
  type LoginFormData,
  type RegisterFormData,
  type RegisterRole,
} from '@/lib/definitions'
import {
  LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER,
  LOGIN_MAX_ATTEMPTS_PER_IP,
  LOGIN_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
  resetAttempts,
} from '@/lib/rate-limit'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extrait une chaîne du FormData (les fichiers deviennent ''). */
function str(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

/** Regroupe les issues Zod par champ (clé du premier segment du path). */
function issuesToErrors(error: z.ZodError): Partial<Record<string, string[]>> {
  const errors: Partial<Record<string, string[]>> = {}
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : '_form'
    const list = errors[key] ?? []
    list.push(issue.message)
    errors[key] = list
  }
  return errors
}

/** Adresse IP du client (derrière le proxy Next / reverse proxy). */
async function clientIp(): Promise<string> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return h.get('x-real-ip') ?? 'local'
}

// ─── Connexion ───────────────────────────────────────────────────────────────

/**
 * Connexion par identifiant (email OU téléphone, héritage legacy) + mot de passe.
 *
 * Sécurité :
 * - rate limiting par identifiant ET par IP AVANT toute vérification ;
 * - message d'erreur strictement générique (aucune fuite sur l'existence
 *   d'un compte) — identique pour compte absent, compte désactivé ou
 *   mauvais mot de passe ;
 * - aucun mot de passe n'est journalisé.
 */
export async function login(
  _prevState: FormState<LoginFormData>,
  formData: FormData,
): Promise<FormState<LoginFormData>> {
  const parsed = LoginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }

  const { identifier, password } = parsed.data
  const idKey = `login:id:${identifier.toLowerCase()}`
  const ipKey = `login:ip:${await clientIp()}`

  const idLimit = checkRateLimit(idKey, LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER, LOGIN_WINDOW_MS)
  const ipLimit = checkRateLimit(ipKey, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS)
  if (!idLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(idLimit.retryAfterMs, ipLimit.retryAfterMs)
    const minutes = Math.max(1, Math.ceil(retryAfter / 60_000))
    return { message: `Trop de tentatives de connexion. Réessayez dans ${minutes} minute(s).` }
  }

  try {
    await signIn('credentials', {
      identifier,
      password,
      redirectTo: '/',
      redirect: false,
    })
  } catch (error) {
    // CredentialsSignin : identifiant ou mot de passe invalide (Auth.js
    // lève cette erreur proprement ; les autres AuthError sont des erreurs
    // de configuration et remontent telles quelles, sans information à
    // l'utilisateur).
    if (error instanceof CredentialsSignin) {
      recordAttempt(idKey)
      recordAttempt(ipKey)
      return { message: 'Email ou mot de passe incorrect.' }
    }
    throw error
  }

  // Connexion réussie : on libère la fenêtre propre à cet identifiant.
  resetAttempts(idKey)
  redirect('/')
}

// ─── Inscription ─────────────────────────────────────────────────────────────

/**
 * Inscription candidat ou recruteur (formulaire unique, rôle sélectionné).
 *
 * Politique anti Mass Assignment (audit) — enregistrement en 3 niveaux :
 * 1. le champ `role` est lu puis confronté à la liste blanche
 *    [candidat, recruteur] : toute autre valeur (ex: `role: "admin"`) est
 *    REJETÉE explicitement, jamais acceptée silencieusement ;
 * 2. les autres champs sont extraits un par un depuis le FormData (jamais
 *    un splat du formulaire entier) : un champ non listé n'entre jamais
 *    dans le payload ;
 * 3. la validation Zod (.strip() par défaut) rejette/retire toute clé
 *    inconnue, et seuls les champs écrits dans le `create` Prisma sont
 *    persistés (colonnes `role`, `isActive`, `emailVerifiedAt`,
 *    `rememberToken`, `id` ne sont jamais pilotées par le formulaire).
 *
 * Après création : redirection vers /login avec message de succès
 * (parité legacy RegisterController::registered → logout + login).
 */
export async function register(
  _prevState: FormState<RegisterFormData>,
  formData: FormData,
): Promise<FormState<RegisterFormData>> {
  const roleInput = formData.get('role')
  if (roleInput !== 'candidat' && roleInput !== 'recruteur') {
    return { errors: { _form: ["Rôle d'inscription invalide."] } }
  }
  const role: RegisterRole = roleInput

  const raw: Record<string, string> = {
    name: str(formData.get('name')),
    email: str(formData.get('email')),
    phone: str(formData.get('phone')),
    password: str(formData.get('password')),
    confirmPassword: str(formData.get('confirmPassword')),
    ...(role === 'recruteur' ? { entrepriseName: str(formData.get('entrepriseName')) } : {}),
  }

  const parsed =
    role === 'candidat'
      ? RegisterCandidatSchema.safeParse(raw)
      : RegisterRecruteurSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }

  const data = parsed.data
  const passwordHash = await bcrypt.hash(data.password, 12)

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        // Champs explicitement listés : aucune colonne sensible
        // (role est figé par la whitelist ci-dessus, isActive et
        // emailVerifiedAt prennent leurs valeurs par défaut de schéma).
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          password: passwordHash,
          role,
        },
      })

      if (role === 'candidat') {
        await tx.candidat.create({ data: { userId: user.id } })
      } else {
        // Guard typeof : le narrowing `in` laisse le type en unknown sur
        // l'union des deux schémas Zod.
        const nomEntreprise =
          'entrepriseName' in data && typeof data.entrepriseName === 'string'
            ? data.entrepriseName
            : data.name
        await tx.entreprise.create({
          data: {
            userId: user.id,
            nom: nomEntreprise,
          },
        })
      }

      // Parité legacy (RegisterController.php) : notification "systeme"
      // à chaque administrateur.
      const admins = await tx.user.findMany({
        where: { role: 'admin' },
        select: { id: true },
      })
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            type: 'systeme',
            titre: 'Nouvel utilisateur inscrit',
            contenu: `${data.name} vient de créer un compte ${role}.`,
            lien: '/admin/utilisateurs',
          })),
        })
      }
    })
  } catch (error) {
    // Unicité email/téléphone (contraintes DB) → erreur de champ, en parité
    // avec le comportement legacy (l'inscription signale le doublon ; c'est
    // la CONNEXION qui reste muette sur l'existence d'un compte).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target
      const targetStr = Array.isArray(target)
        ? target.map(String).join(',')
        : typeof target === 'string'
          ? target
          : ''
      if (targetStr.includes('phone')) {
        return { errors: { phone: ['Ce numéro est déjà utilisé.'] } }
      }
      return { errors: { email: ['Cet email est déjà utilisé.'] } }
    }
    throw error
  }

  redirect('/login?registered=1')
}

// ─── Déconnexion ─────────────────────────────────────────────────────────────

/**
 * Déconnexion : Auth.js supprime le cookie de session (et toute Session en
 * base si une stratégie database est active). En stratégie JWT, le jeton
 * reste techniquement valide jusqu'à son expiration s'il avait été copié :
 * c'est la limite connue des sessions stateless, acceptée pour M1
 * (révocation serveur possible plus tard par liste de jti).
 */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/' })
}
