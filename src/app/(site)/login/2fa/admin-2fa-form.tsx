'use client'

import { useActionState } from 'react'

import { annulerChallengeAdmin } from '@/app/actions/admin-challenge'
import { entrerCodeAdmin } from '@/app/actions/admin-auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function Admin2faForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(entrerCodeAdmin, {})

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">Vérification</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Saisissez le code à 6 chiffres de votre application d’authentification pour
        le compte {email ?? 'administrateur'}. Un code de récupération est aussi
        accepté.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {state?.message && (
          <p
            role="alert"
            className="rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        )}

        <Input
          id="code"
          name="code"
          type="text"
          label="Code d’authentification"
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={32}
          required
          autoFocus
          error={state?.errors?.code?.[0]}
        />

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Vérification en cours…' : 'Vérifier'}
        </Button>
      </form>

      <form action={annulerChallengeAdmin} className="mt-3">
        <Button type="submit" variant="secondary" className="w-full">
          Revenir à la connexion
        </Button>
      </form>
    </Card>
  )
}
