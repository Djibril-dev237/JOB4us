import Link from 'next/link'

// ─── Accueil : placeholder de migration ──────────────────────────────────────
// La vraie page d'accueil (hero, catégories, offres, statistiques) sera
// construite avec le module contenu/offres. Ce placeholder remplace le template
// Next (contenu de démo, boutons en pilule, anglais) pour respecter les
// contraintes de design en attendant.
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        <span className="text-brand">Job</span>
        <span className="text-accent">4Us</span>
      </h1>
      <p className="mt-3 text-base text-ink-muted">
        Offres d&apos;emploi et recrutement au Cameroun.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/offres"
          className="inline-flex h-10 items-center rounded-sm bg-brand px-4 text-sm font-medium text-white transition-colors duration-fast hover:bg-brand-dark"
        >
          Voir les offres
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
