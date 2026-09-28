import type { Metadata } from 'next'
import Link from 'next/link'

// Titre court : le template global ajoute « | Job4Us ».
export const metadata: Metadata = { title: 'Accès refusé' }

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold tracking-tight text-ink">Accès refusé</h1>
        <p className="mt-3 text-sm text-ink-muted">
          Votre compte ne dispose pas des autorisations nécessaires pour accéder à cette
          page.
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <Link href="/" className="font-medium text-brand hover:underline">
            Retour à l&apos;accueil
          </Link>
          <Link href="/login" className="font-medium text-brand hover:underline">
            Se connecter
          </Link>
        </div>
      </div>
    </div>
  )
}
