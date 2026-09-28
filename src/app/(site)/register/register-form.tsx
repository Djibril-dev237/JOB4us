'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'

import { register } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { RegisterRole } from '@/lib/definitions'

const ROLE_OPTIONS: { value: RegisterRole; label: string; description: string }[] = [
  { value: 'candidat', label: 'Candidat', description: 'Je cherche un emploi' },
  { value: 'recruteur', label: 'Recruteur', description: 'Je publie des offres' },
]

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(register, undefined)
  const [role, setRole] = useState<RegisterRole>('candidat')

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">Créer un compte</h1>

      <form action={formAction} className="mt-6 space-y-4">
        {state?.errors?._form?.[0] && (
          <p
            role="alert"
            className="rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger"
          >
            {state.errors._form[0]}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-ink">Je suis un</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-sm border px-3 py-2 text-sm transition-colors duration-fast ${
                  role === option.value
                    ? 'border-brand bg-brand-tint'
                    : 'border-line-strong bg-surface hover:bg-surface-alt'
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                  className="sr-only"
                />
                <span
                  className={`block font-medium ${role === option.value ? 'text-brand-dark' : 'text-ink'}`}
                >
                  {option.label}
                </span>
                <span className="block text-xs text-ink-muted">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Input
          id="name"
          name="name"
          type="text"
          label="Nom complet"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          error={state?.errors?.name?.[0]}
        />

        <Input
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          error={state?.errors?.email?.[0]}
        />

        <Input
          id="phone"
          name="phone"
          type="tel"
          label="Téléphone (optionnel)"
          autoComplete="tel"
          placeholder="+237 6 00 00 00 00"
          error={state?.errors?.phone?.[0]}
        />

        {role === 'recruteur' && (
          <Input
            id="entrepriseName"
            name="entrepriseName"
            type="text"
            label="Nom de l'entreprise"
            required
            minLength={2}
            maxLength={200}
            error={state?.errors?.entrepriseName?.[0]}
          />
        )}

        <Input
          id="password"
          name="password"
          type="password"
          label="Mot de passe"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          error={state?.errors?.password?.[0]}
        />

        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirmer le mot de passe"
          autoComplete="new-password"
          required
          error={state?.errors?.confirmPassword?.[0]}
        />

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Création du compte…' : 'Créer mon compte'}
        </Button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Se connecter
        </Link>
      </p>
    </Card>
  )
}
