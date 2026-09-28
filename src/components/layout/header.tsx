import Link from 'next/link'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { IconBell } from '@/components/icons'
import { AvatarMenu } from './avatar-menu'
import { Logo } from './logo'
import { MobileMenu } from './mobile-menu'
import { NavLinks } from './nav-links'
import { NAV_PRIMARY, NAV_SECONDARY, PUBLIC_NAV } from './nav'
import { SearchForm } from './search-form'

// ─── Header global ───────────────────────────────────────────────────────────
// Server component : session Auth.js + compteur de notifications non lues.
// Réf. layouts/app.blade.php (navbar 64px, ombre 0 1px 8px) :
// - visiteur : liens publics centrés + Connexion (contour bleu) /
//   Créer un compte (plein) — la recherche vit dans le hero de l'accueil ;
// - connecté  : recherche 340px + cloche (compteur réel, orange accent-strong)
//   + menu profil ; la navigation du rôle migre dans la sidebar (groupe (app)) ;
// - < lg      : tiroir mobile (burger) qui reprend les mêmes navigations.
// ---------------------------------------------------------------------------

export async function Header() {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  const isAuthed = typeof userId === 'number' && !!role

  const unread = isAuthed
    ? await prisma.notification.count({ where: { userId, isLu: false } })
    : 0

  const primary = isAuthed ? NAV_PRIMARY[role] : PUBLIC_NAV
  const secondary = isAuthed ? NAV_SECONDARY[role] : []

  const name = session?.user?.name ?? 'Mon compte'
  const email = session?.user?.email ?? null

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <Logo />

        <div className="hidden flex-1 justify-center lg:flex">
          <NavLinks items={primary} />
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {isAuthed && <SearchForm />}

          {isAuthed && role ? (
            <>
              <Link
                href="/notifications"
                className="relative flex size-11 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink sm:size-9"
              >
                <span className="sr-only">
                  Notifications{unread > 0 ? `, ${unread} non lues` : ''}
                </span>
                <IconBell size={18} />
                {unread > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-strong px-1 text-2xs font-semibold text-white"
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>

              <AvatarMenu
                user={{ name, email, role }}
                items={secondary}
              />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-9 items-center rounded-sm border border-brand px-3 text-sm font-medium text-brand transition-colors duration-fast hover:bg-brand-tint hover:text-brand-dark sm:inline-flex"
              >
                Connexion
              </Link>
              <Link
                href="/register"
                className="hidden h-9 items-center rounded-sm bg-brand px-3.5 text-sm font-medium text-white transition-colors duration-fast hover:bg-brand-dark md:inline-flex"
              >
                Créer un compte
              </Link>
            </>
          )}

          <MobileMenu
            primary={primary}
            secondary={secondary}
            user={isAuthed && role ? { name, role } : null}
          />
        </div>
      </div>
    </header>
  )
}
