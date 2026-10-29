'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { activerCompteAdmin } from '@/app/actions/admin-activation'
import { Button, buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface ActivationAdminFormProps {
  token: string
  secret: string
  otpauthUri: string
  nom: string
  email: string | null
}

export function ActivationAdminForm({
  token,
  secret,
  otpauthUri,
  nom,
  email,
}: ActivationAdminFormProps) {
  const [state, formAction, pending] = useActionState(activerCompteAdmin, {})

  if (state.recoveryCodes && state.recoveryCodes.length > 0) {
    return (
      <Card className="w-full max-w-xl p-6">
        <h1 className="text-xl font-bold tracking-tight text-ink">
          Compte administrateur activé
        </h1>
        <p className="mt-2 text-sm text-ink">
          Conservez ces dix codes de récupération dans un endroit sûr. Chaque
          code ne fonctionne qu’une seule fois et ils ne seront plus jamais
          affichés.
        </p>
        <ul className="mt-4 grid gap-2 rounded-sm border border-line bg-surface-alt p-4 font-mono text-sm text-ink sm:grid-cols-2">
          {state.recoveryCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Vous pouvez maintenant vous connecter avec votre mot de passe et votre
          application d’authentification.
        </p>
        <Link href="/login" className={buttonClassName(undefined, undefined, 'mt-4')}>
          Aller à la connexion
        </Link>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-xl p-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">
        Activation du compte administrateur
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Bonjour {nom}. Ce lien est personnel et expire dans 24 heures. Choisissez
        un mot de passe, puis configurez votre application d’authentification.
      </p>

      <div className="mt-4 rounded-sm border border-line bg-surface-alt p-4">
        <p className="text-sm font-medium text-ink">1. Ajoutez le compte à votre application</p>
        <p className="mt-1 text-sm text-ink-muted">
          Saisissez ce secret dans votre application d’authentification (Google
          Authenticator, Aegis, 1Password, etc.).
        </p>
        <code className="mt-2 block break-all rounded-sm border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
          {secret}
        </code>
        <a
          href={otpauthUri}
          className="mt-2 inline-block text-sm font-medium text-brand hover:underline"
        >
          Ouvrir directement dans l’application
        </a>
        {email && <p className="mt-2 text-xs text-ink-muted">Compte : {email}</p>}
      </div>

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="secret" value={secret} />

        {state.message && (
          <p
            role="alert"
            className="rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        )}

        <div>
          <p className="text-sm font-medium text-ink">2. Choisissez un mot de passe</p>
          <p className="mt-1 text-xs text-ink-muted">
            Au moins 12 caractères, avec une majuscule, une minuscule et un
            chiffre.
          </p>
        </div>

        <Input
          id="password"
          name="password"
          type="password"
          label="Mot de passe"
          autoComplete="new-password"
          required
          error={state.errors?.password?.[0]}
        />

        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          label="Confirmer le mot de passe"
          autoComplete="new-password"
          required
          error={state.errors?.confirmPassword?.[0]}
        />

        <div>
          <p className="text-sm font-medium text-ink">3. Validez le premier code</p>
          <p className="mt-1 text-xs text-ink-muted">
            Saisissez le code à 6 chiffres affiché par votre application.
          </p>
        </div>

        <Input
          id="code"
          name="code"
          type="text"
          label="Code d’authentification"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          required
          error={state.errors?.code?.[0]}
        />

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Activation en cours…' : 'Activer le compte'}
        </Button>
      </form>
    </Card>
  )
}
