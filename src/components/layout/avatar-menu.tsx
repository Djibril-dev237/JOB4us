'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'

import { logout } from '@/app/actions/auth'
import { IconChevronDown, IconLogout } from '@/components/icons'
import type { Role } from '@/lib/definitions'
import { ROLE_LABEL, type NavItem } from './nav'

// ─── Menu profil (dropdown) ──────────────────────────────────────────────────
// Navigation dropdown, pas un menu ARIA : liens focusables au Tab, fermeture
// par Escape (retour du focus sur le bouton), par clic extérieur et par
// activation d'un lien. Le bouton expose aria-expanded/aria-controls.
// ---------------------------------------------------------------------------

interface AvatarMenuProps {
  user: {
    name: string
    email: string | null
    role: Role
  }
  /** Navigation secondaire du rôle (liens du dropdown). */
  items: NavItem[]
}

/** Initiales pour l'avatar (1 ou 2 caractères). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function AvatarMenu({ user, items }: AvatarMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Fermeture par Escape + retour du focus sur le bouton.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Fermeture par clic extérieur (pointerdown pour ne pas attendre le click).
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative self-stretch md:self-stretch">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 items-center gap-1.5 rounded-sm border border-line px-1.5 text-sm transition-colors duration-fast hover:bg-surface-alt sm:h-9"
      >
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand"
        >
          {initials(user.name)}
        </span>
        <span className="max-w-24 truncate text-ink sm:max-w-36">{user.name}</span>
        <IconChevronDown
          size={14}
          className={`hidden text-ink-muted transition-transform duration-fast sm:block ${open ? 'rotate-180' : ''}`}
        />
        <span className="sr-only">Menu du compte</span>
      </button>

      {open && (
        <div
          id={menuId}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-lift"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            {user.email && (
              <p className="mt-0.5 truncate text-xs text-ink-muted">{user.email}</p>
            )}
            <span className="mt-2 inline-block rounded-sm bg-brand-tint px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-brand">
              {ROLE_LABEL[user.role]}
            </span>
          </div>

          <hr className="my-1 border-line" />

          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-sm px-3 py-2 text-sm text-ink transition-colors duration-fast hover:bg-surface-alt"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <hr className="my-1 border-line" />

          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-danger transition-colors duration-fast hover:bg-danger-tint"
            >
              <IconLogout size={16} />
              Se déconnecter
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
