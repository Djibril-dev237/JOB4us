import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'

// ─── Sélecteur avec label et erreur ──────────────────────────────────────────
// Liste native (<select>) : clavier et lecteurs d'écran opérationnels sans
// ARIA maison. Même contrat d'accessibilité que <Input>.
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: SelectOption[]
  /** Ajoute une option vide en tête (valeur ''). */
  withEmpty?: boolean
  emptyLabel?: string | undefined
  labelClassName?: string | undefined
  /** Message d'erreur : bascule le champ en état invalide. */
  error?: string | undefined
}

export function Select({
  label,
  options,
  withEmpty,
  emptyLabel,
  labelClassName,
  error,
  id,
  className,
  ...props
}: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  const errorId = `${selectId}-error`

  return (
    <div>
      <label
        htmlFor={selectId}
        className={`block text-sm font-medium text-ink ${labelClassName ?? ''}`}
      >
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          'mt-1.5 h-10 w-full rounded-sm border-[1.5px] bg-surface px-3 text-sm text-ink',
          'transition-colors duration-fast focus:border-brand',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-danger' : 'border-line',
          className ?? '',
        ].join(' ')}
        {...props}
      >
        {withEmpty && <option value="">{emptyLabel ?? '—'}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
