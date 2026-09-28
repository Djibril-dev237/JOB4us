'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { logout } from '@/app/actions/auth'
import { IconClose, IconLogout, IconMenu } from '@/components/icons'
import type { Role } from '@/lib/definitions'
import { Logo } from './logo'
import { ROLE_LABEL, isActiveLink, type NavItem } from './nav'

// ─── Menu mobile (tiroir) ────────────────────────────────────────────────────
// Exigences M2 :
// - ouverture/fermeture : burger + bouton fermer + fond cliquable + Escape ;
// - clavier : focus initial sur le panneau, piège Tab/Shift+Tab à l'intérieur,
//   retour du focus sur le burger à la fermeture ;
// - fermeture au changement de page (usePathname) avec retour du focus ;
// - cibles tactiles >= 44px, safe-area en bas ;
// - animation 200ms (token duration-base), neutralisée par prefers-reduced-motion.
// La cause du bug mobile legacy (sidebar fixe sans breakpoint) n'existe pas
// ici : ce composant est la navigation mobile, pas un retrait de desktop.
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1]

interface MobileMenuProps {
  /** Navigation primaire du rôle (ou navigation publique). */
  primary: NavItem[]
  /** Navigation secondaire du rôle (vide pour le visiteur). */
  secondary: NavItem[]
  /** Utilisateur connecté, ou null pour le visiteur. */
  user: { name: string; role: Role } | null
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

export function MobileMenu({ primary, secondary, user }: MobileMenuProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const reducedMotion = useReducedMotion()
  const burgerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(false)
  const menuId = useId()

  // Mémorise l'état ouvert pour l'effet de navigation ci-dessous.
  useEffect(() => {
    isOpenRef.current = open
  }, [open])

  // Fermeture au changement de page + retour du focus sur le burger.
  useEffect(() => {
    if (isOpenRef.current) {
      setOpen(false)
      burgerRef.current?.focus()
    }
  }, [pathname])

  // Focus initial sur le panneau + verrouillage du scroll de la page.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  // Escape ferme le tiroir et rend le focus au burger.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        burgerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  function close() {
    setOpen(false)
    burgerRef.current?.focus()
  }

  // Piège de focus : Tab circule uniquement à l'intérieur du panneau.
  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const container = event.currentTarget
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (focusables.length === 0) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === container)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const slide = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { x: '-100%' }, animate: { x: 0 }, exit: { x: '-100%' } }

  return (
    <>
      {/* Déclencheur (burger) : visible sous lg, le desktop a sa propre nav */}
      <button
        ref={burgerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex size-11 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink lg:hidden"
      >
        <IconMenu size={20} />
        <span className="sr-only">Ouvrir le menu</span>
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            {/* Fond assombri : clique pour fermer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-ink/40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            <motion.div
              ref={panelRef}
              id={menuId}
              role="dialog"
              aria-modal="true"
              aria-label="Menu de navigation"
              tabIndex={-1}
              onKeyDown={trapFocus}
              {...slide}
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: EASE_STANDARD }}
              className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-surface shadow-lift focus:outline-none"
            >
              {/* En-tête du tiroir */}
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <Logo />
                <button
                  type="button"
                  onClick={close}
                  className="flex size-11 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink"
                >
                  <IconClose size={20} />
                  <span className="sr-only">Fermer le menu</span>
                </button>
              </div>

              {/* Navigation */}
              <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-4">
                <ul className="space-y-1">
                  {primary.map((item) => (
                    <li key={item.href}>
                      <MobileNavLink item={item} pathname={pathname} />
                    </li>
                  ))}
                </ul>

                {secondary.length > 0 && (
                  <>
                    <hr className="my-4 border-line" />
                    <ul className="space-y-1">
                      {secondary.map((item) => (
                        <li key={item.href}>
                          <MobileNavLink item={item} pathname={pathname} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </nav>

              {/* Actions de bas de tiroir */}
              <div className="border-t border-line px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {user ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-9 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand"
                      >
                        {initials(user.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                          {ROLE_LABEL[user.role]}
                        </span>
                      </div>
                    </div>
                    <form action={logout}>
                      <button
                        type="submit"
                        onClick={close}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-line-strong text-sm font-medium text-danger transition-colors duration-fast hover:bg-danger-tint"
                      >
                        <IconLogout size={16} />
                        Se déconnecter
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Link
                      href="/login"
                      onClick={close}
                      className="flex h-11 items-center justify-center rounded-sm bg-brand text-sm font-medium text-white transition-colors duration-fast hover:bg-brand-dark"
                    >
                      Connexion
                    </Link>
                    <Link
                      href="/register"
                      onClick={close}
                      className="flex h-11 items-center justify-center rounded-sm border border-line-strong text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-alt"
                    >
                      Créer un compte
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Lien du tiroir : filet actif 3px à gauche (signature direction B). */
function MobileNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActiveLink(pathname, item.href)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center rounded-sm border-l-[3px] px-3 text-sm transition-colors duration-fast ${
        active
          ? 'border-brand bg-brand-tint font-medium text-brand'
          : 'border-transparent text-ink hover:bg-surface-alt'
      }`}
    >
      {item.label}
    </Link>
  )
}
