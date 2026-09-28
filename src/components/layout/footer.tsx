import Link from 'next/link'

import { Logo } from './logo'

// ─── Footer global ───────────────────────────────────────────────────────────
// Bande unique, fond surface-alt, motif de marches en aplat bleu très pâle :
// c'est l'UNIQUE usage décoratif du projet (signature de la direction B,
// référence Haikei — formes géométriques génératives), sans dégradé.
// Les liens vers les espaces protégés redirigent vers /login pour les
// visiteurs (proxy), et seront pleinement utiles après migration des modules.
// ---------------------------------------------------------------------------

interface FooterNav {
  title: string
  links: { label: string; href: string }[]
}

const FOOTER_NAVS: FooterNav[] = [
  {
    title: 'Candidats',
    links: [
      { label: "Offres d'emploi", href: '/offres' },
      { label: 'Mes candidatures', href: '/candidat/candidatures' },
      { label: 'Offres sauvegardées', href: '/candidat/offres/sauvegardees' },
    ],
  },
  {
    title: 'Recruteurs',
    links: [
      { label: 'Mes offres', href: '/recruteur/offres' },
      { label: 'Candidatures reçues', href: '/recruteur/candidatures' },
      { label: 'Recherche candidats', href: '/recruteur/candidats' },
    ],
  },
  {
    title: 'Compte',
    links: [
      { label: 'Connexion', href: '/login' },
      { label: "Créer un compte", href: '/register' },
      { label: 'Paramètres', href: '/parametres' },
    ],
  },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-line bg-surface-alt">
      {/* Motif marches : signature décorative unique, aplat, aria-hidden */}
      <div aria-hidden="true" className="h-8 w-full overflow-hidden">
        <svg className="h-full w-full" viewBox="0 0 1200 32" preserveAspectRatio="none">
          <path
            d="M0 32V18h300V10h300v14h300V6h300v26z"
            fill="var(--color-brand-tint)"
          />
        </svg>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 py-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-ink-muted">
              Offres d&apos;emploi et recrutement au Cameroun.
            </p>
          </div>

          {FOOTER_NAVS.map((nav) => (
            <nav key={nav.title} aria-label={nav.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {nav.title}
              </h2>
              <ul className="mt-3 space-y-1">
                {nav.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="flex min-h-9 items-center text-sm text-ink transition-colors duration-fast hover:text-brand"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-t border-line py-6 text-xs text-ink-muted">
          © {year} Job4Us — Cameroun · Afrique.
        </div>
      </div>
    </footer>
  )
}
