import Link from 'next/link'

import { Logo } from './logo'

// ─── Footer global ───────────────────────────────────────────────────────────
// Bande unique sombre : fond ink navy #0F172A (mêmes tokens que le reste de
// l'app, pas de couleur hors système), texte blanc / canvas / ink-faint —
// tous ≥ 6,9:1 sur le fond. Le motif « marches » et le fond clair de la
// direction B sont retirés : la direction PHP+ privilégie la sobriété
// (ornement unique retiré plutôt que réadapté).
// Structure 4 colonnes identique à l'actuelle (marque + navigation par
// audience), fidèle au principe PHP « pied de page unique sur toutes les
// pages publiques ».
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
      // Pas d'entrée « Recherche candidats » : annuaire supprimé pour
      // confidentialité (décision documentée dans nav.ts).
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
    <footer className="bg-ink">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo variant="dark" />
            <p className="mt-3 max-w-xs text-sm text-ink-faint">
              Offres d&apos;emploi et recrutement au Cameroun.
            </p>
          </div>

          {FOOTER_NAVS.map((nav) => (
            <nav key={nav.title} aria-label={nav.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-white">
                {nav.title}
              </h2>
              <ul className="mt-3 space-y-0.5">
                {nav.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="flex min-h-9 items-center text-sm text-canvas transition-colors duration-fast hover:text-white hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-t border-white/10 py-6 text-xs text-ink-faint">
          © {year} Job4Us · Cameroun · Afrique.
        </div>
      </div>
    </footer>
  )
}
