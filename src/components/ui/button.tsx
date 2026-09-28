import type { ButtonHTMLAttributes } from 'react'

// ─── Bouton ──────────────────────────────────────────────────────────────────
// États : focus-visible (anneau global globals.css), hover (couleur), disabled
// (opacité + pointer-events coupés). Rayon système 4px, jamais de pilule.
// Les liens stylés en bouton réutilisent buttonClassName().
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-alt',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-tint',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
}

/** Classes d'un bouton, réutilisables sur un <Link> ou un <button>. */
export function buttonClassName(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors duration-fast',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className ?? '',
  ].join(' ')
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, size, className)} {...props} />
}
