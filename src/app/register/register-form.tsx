'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'

import { register } from '@/app/actions/auth'
import type { RegisterRole } from '@/lib/definitions'

const ROLE_OPTIONS: { value: RegisterRole; label: string; description: string }[] = [
  { value: 'candidat', label: 'Candidat', description: 'Je cherche un emploi' },
  { value: 'recruteur', label: 'Recruteur', description: 'Je publie des offres' },
]

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(register, undefined)
  const [role, setRole] = useState<RegisterRole>('candidat')

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold text-zinc-900">Créer un compte</h1>

      <form action={formAction} className="mt-6 space-y-4">
        {state?.errors?._form?.[0] && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {state.errors._form[0]}
          </p>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-zinc-700">Je suis un</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                  role === option.value
                    ? 'border-zinc-900 bg-zinc-50'
                    : 'border-zinc-300'
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
                <span className="block font-medium text-zinc-900">{option.label}</span>
                <span className="block text-xs text-zinc-600">{option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Nom complet
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.name?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.name[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.email?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.email[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-zinc-700">
            Téléphone (optionnel)
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+237 6 00 00 00 00"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.phone?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.phone[0]}</p>
          )}
        </div>

        {role === 'recruteur' && (
          <div>
            <label htmlFor="entrepriseName" className="block text-sm font-medium text-zinc-700">
              Nom de l&apos;entreprise
            </label>
            <input
              id="entrepriseName"
              name="entrepriseName"
              type="text"
              required
              minLength={2}
              maxLength={200}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            />
            {state?.errors?.entrepriseName?.[0] && (
              <p className="mt-1 text-sm text-red-600">{state.errors.entrepriseName[0]}</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.password?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.password[0]}</p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-700">
            Confirmer le mot de passe
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
          {state?.errors?.confirmPassword?.[0] && (
            <p className="mt-1 text-sm text-red-600">{state.errors.confirmPassword[0]}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Création du compte' : 'Créer mon compte'}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-600">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Se connecter
        </Link>
      </p>
    </div>
  )
}
