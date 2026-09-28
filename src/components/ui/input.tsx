import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

// ─── Champ de saisie avec label et erreur ────────────────────────────────────
// Accessibilité : label associé (htmlFor/id), erreur liée via
// aria-describedby + aria-invalid, focus-visible global (globals.css),
// bordure passe au bleu de marque au focus. États désactivés prévus.
// Réf. champs PHP : bordure 1.5px #E2E8F0, rayon 8px ; les labels passent
// en capitales via labelClassName sur les formulaires auth.
// ---------------------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Classes du label (ex. « uppercase text-xs » sur les pages auth). */
  labelClassName?: string | undefined
  /** Message d'erreur : bascule le champ en état invalide. */
  error?: string | undefined
}

export function Input({ label, labelClassName, error, id, className, ...props }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  return (
    <div>
      <label
        htmlFor={inputId}
        className={`block text-sm font-medium text-ink ${labelClassName ?? ''}`}
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          'mt-1.5 h-10 w-full rounded-sm border-[1.5px] bg-surface px-3 text-sm text-ink',
          'placeholder:text-ink-muted transition-colors duration-fast focus:border-brand',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-danger' : 'border-line',
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
