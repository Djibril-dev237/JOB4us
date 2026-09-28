'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'

import { login } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface UrlFlags {
  /** Compte créé avec succès avant redirection (?registered=1). */
  registered: boolean
  /** Redirection d'erreur Auth.js (?error=...), message générique. */
  authError: boolean
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined)

  // Flags d'URL lus côté client au montage, et non via `await searchParams`
  // sur la page : sur Next 16.3.6, une page qui suspend sous `loading.tsx`
  // n'est jamais hydratée (vercel/next.js#98097). Lecture différée = aucun
  // écart d'hydratation possible, le bandeau apparaît au premier rendu client.
  const [urlFlags, setUrlFlags] = useState<UrlFlags>({ registered: false, authError: false })

  useEffect(() => {
    // Différé d'une microtask : la lecture se fait strictement après le commit
    // d'hydratation (le HTML serveur ne peut pas connaître les flags d'URL) et
    // hors corps synchrone de l'effet (règle react-hooks/set-state-in-effect).
    let active = true
    queueMicrotask(() => {
      if (!active) return
      const query = new URLSearchParams(window.location.search)
      setUrlFlags({
        registered: query.get('registered') === '1',
        authError: query.has('error'),
      })
    })
    return () => {
      active = false
    }
  }, [])

  const formError = state?.message ?? (urlFlags.authError ? 'Email ou mot de passe incorrect.' : null)

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">Connexion</h1>

      {urlFlags.registered && (
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
