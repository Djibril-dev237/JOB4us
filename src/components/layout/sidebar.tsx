'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

import { logout } from '@/app/actions/auth'
import { IconLogout } from '@/components/icons'
import { initials } from './avatar-menu'
import { isActiveLink, ROLE_LABEL, SIDEBAR_NAV } from './nav'

// ─── Sidebar du shell connecté ───────────────────────────────────────────────
// Réf. layouts/partiel/sidebar-*.blade.php : profil en haut, sections
// (titre + liens), déconnexion en bas. Largeur 264px exactement comme le PHP,
// mais présente uniquement à >= 1024px (le bug mobile PHP — sidebar fixe
// sans media query — n'est pas porté ; le tiroir prend le relais en mobile).
// État actif : fond #EFF6FF + texte brand-dark + filet gauche 3px (le
// #0066FF du PHP sur ce fond plafonne à 4,44:1, d'où brand-dark à 7,6:1).
//
// Session : useSession() côté client (voir session-provider.tsx) — aucun
// await dans le rendu serveur (bug upstream vercel/next.js#98097). Premier
// rendu : profil en squelette, sections peuplées après la session (même
// structure serveur/client → hydratation intacte).
// ---------------------------------------------------------------------------

export function Sidebar() {
  const { data: session, status } = useSession()
  const pathname = usePathname()

  // Hors session (expiration côté client) : le proxy aura déjà redirigé ;
  // pas de navigation à afficher.
  if (status === 'unauthenticated') return null

  const user = session?.user
  const role = user?.role
  const name = user?.name ?? 'Mon compte'
  const loading = status === 'loading'

  return (
    <aside
      aria-label="Navigation de l'espace"
      className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[264px] shrink-0 overflow-y-auto border-r border-line bg-surface lg:block"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-brand-tint text-sm font-semibold text-brand-dark"
        >
          {loading ? '' : initials(name)}
        </span>
        <div className="min-w-0">
          {loading ? (
            <>
              <div aria-hidden="true" className="h-3.5 w-24 animate-pulse rounded-sm bg-surface-alt" />
              <div aria-hidden="true" className="mt-1.5 h-2.5 w-16 animate-pulse rounded-sm bg-surface-alt" />
            </>
          ) : (
            <>
              <p className="truncate text-sm font-medium text-ink">{name}</p>
              <p className="truncate text-2xs text-ink-muted">
                {role ? ROLE_LABEL[role] : ''}
              </p>
            </>
          )}
        </div>
      </div>

      {role && (
        <nav className="space-y-5 p-3">
          {SIDEBAR_NAV[role].map((section) => (
            <div key={section.title}>
              <h2 className="px-3 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                {section.title}
              </h2>
              <ul className="mt-1 space-y-0.5">
                {section.items.map((item) => {
                  const active = isActiveLink(pathname, item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-9 items-center rounded-sm border-l-[3px] px-3 py-1.5 text-sm transition-colors duration-fast ${
                          active
                            ? 'border-brand bg-brand-tint font-medium text-brand-dark'
                            : 'border-transparent text-ink-muted hover:bg-surface-alt hover:text-ink'
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      )}

      {!loading && (
        <div className="border-t border-line p-3">
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-ink-muted transition-colors duration-fast hover:bg-danger-tint hover:text-danger"
            >
              <IconLogout size={16} />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </aside>
  )
}
