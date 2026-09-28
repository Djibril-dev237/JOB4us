'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { NavItem } from './nav'

// ─── Liens de navigation principale (desktop) ────────────────────────────────
// État actif = aria-current="page" + filet 3px bleu ancré au bas du header
// (signature de la direction B, reprise de la barre active de la sidebar
// legacy). Le lien occupe toute la hauteur du header : cible tactile 64px.
// ---------------------------------------------------------------------------

interface NavLinksProps {
  items: NavItem[]
  className?: string
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavLinks({ items, className }: NavLinksProps) {
  const pathname = usePathname()

  return (
    <nav aria-label="Navigation principale" className={className}>
      <ul className="flex items-center">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-16 items-center px-3 text-sm transition-colors duration-fast ${
                  active
                    ? 'font-medium text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-brand after:content-[""]'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
