'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { login } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">Connexion</h1>

      {registered && (
        <p
          role="status"
          className="mt-4 rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok"
        >
          Compte créé. Vous pouvez maintenant vous connecter.
        </p>
      )}

      <form action={formAction} className="mt-6 space-y-4">
        {formError && (
          <p
            role="alert"
            className="rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        )}

        <Input
          id="identifier"
          name="identifier"
          type="text"
          label="Email ou téléphone"
          autoComplete="username"
          required
          error={state?.errors?.identifier?.[0]}
        />

        <Input
          id="password"
          name="password"
          type="password"
          label="Mot de passe"
          autoComplete="current-password"
          required
          error={state?.errors?.password?.[0]}
        />

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Connexion en cours…' : 'Se connecter'}
        </Button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        Pas encore de compte ?{' '}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Créer un compte
        </Link>
      </p>
    </Card>
  )
}
