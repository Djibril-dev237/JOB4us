import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Accès refusé | Job4Us' }

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Accès refusé</h1>
        <p className="mt-3 text-sm text-zinc-600">
          Votre compte ne dispose pas des autorisations nécessaires pour accéder à cette page.
        </p>
        <div className="mt-6 flex justify-center gap-4 text-sm">
          <Link href="/" className="font-medium text-zinc-900 underline">
            Retour à l&apos;accueil
          </Link>
          <Link href="/login" className="font-medium text-zinc-900 underline">
            Se connecter
          </Link>
        </div>
      </div>
    </main>
  )
}
