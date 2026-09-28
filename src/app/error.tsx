'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// ─── Page d'erreur applicative ───────────────────────────────────────────────
// Attrape les erreurs rendues dans la page (le layout racine reste en place).
// Aucun détail technique n'est affiché : journalisation console + message
// sobre, comme exigé par la politique d'erreurs de M1.
// ---------------------------------------------------------------------------

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[calc(100svh-14rem)] w-full max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-2xs font-semibold uppercase tracking-[0.15em] text-ink-muted">
        Erreur
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
        Une erreur est survenue
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        La page n&apos;a pas pu être chargée. Vous pouvez réessayer.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-sm font-medium text-white transition-colors duration-fast hover:bg-brand-dark"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-sm border border-line-strong px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-alt"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
