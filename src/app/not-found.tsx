import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-14rem)] w-full max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-2xs font-semibold uppercase tracking-[0.15em] text-ink-muted">
        Erreur 404
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
        Page introuvable
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        Cette page n&apos;existe pas ou n&apos;est plus disponible.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-sm font-medium text-white transition-colors duration-fast hover:bg-brand-dark"
        >
          Retour à l&apos;accueil
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-sm border border-line-strong px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-alt"
        >
          Connexion
        </Link>
      </div>
    </div>
  )
}
