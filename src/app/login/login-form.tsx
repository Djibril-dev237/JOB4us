'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { login } from '@/app/actions/auth'

interface LoginFormProps {
  /** Compte créé avec succès avant redirection (?registered=1). */
  registered: boolean
  /** Redirection d'erreur Auth.js (?error=...), message générique. */
  authError: boolean
}

export function LoginForm({ registered, authError }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, undefined)

  const formError = state?.message ?? (authError ? 'Email ou mot de passe incorrect.' : null)

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold text-zinc-900">Connexion</h1>

      {registered && (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Compte créé. Vous pouvez maintenant vous connecter.
        </p>
      )}

      <form action={formAction} className="mt-6 space-y-4">
        {formError && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </p>
        )}

        <div>
          <label htmlFor="identifier" className="block text-sm font-medium text-zinc-700">
            Email ou téléphone
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.identifier?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.identifier[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.password?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.password[0]}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Connexion en cours' : 'Se connecter'}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        Pas encore de compte ?{' '}
        <Link href="/register" className="font-medium text-zinc-900 underline">
          Créer un compte
        </Link>
      </p>
    </div>
  )
}
