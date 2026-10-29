'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { reauthentifierAdmin } from '@/app/actions/admin-auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function ReauthAdminForm({ retour }: { retour: string }) {
  const [state, formAction, pending] = useActionState(reauthentifierAdmin, {})

  return (
    <Card className="w-full max-w-md p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">
        Confirmer votre identité
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Cette action sensible demande une vérification récente. Saisissez le code
        à 6 chiffres de votre application d’authentification, ou un code de
        récupération. La confirmation reste valable 5 minutes.
      </p>

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="retour" value={retour} />
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
        />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Vérification en cours…' : 'Confirmer'}
        </Button>
      </form>

      <Link
        href={retour}
        className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
      >
        Annuler et revenir
      </Link>
    </Card>
  )
}
