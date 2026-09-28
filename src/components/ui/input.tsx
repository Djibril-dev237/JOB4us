import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

// ─── Champ de saisie avec label et erreur ────────────────────────────────────
// Accessibilité : label associé (htmlFor/id), erreur liée via
// aria-describedby + aria-invalid, focus-visible global (globals.css),
// bordure passe au bleu de marque au focus. États désactivés prévus.
// ---------------------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Message d'erreur : bascule le champ en état invalide. */
  error?: string | undefined
}

export function Input({ label, error, id, className, ...props }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          'mt-1.5 h-10 w-full rounded-sm border bg-surface px-3 text-sm text-ink',
          'placeholder:text-ink-muted transition-colors duration-fast focus:border-brand',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-danger' : 'border-line-strong',
          className ?? '',
        ].join(' ')}
        {...props}
      />
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
