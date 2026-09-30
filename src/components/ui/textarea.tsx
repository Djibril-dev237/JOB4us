import { useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'

// ─── Zone de texte avec label et erreur ──────────────────────────────────────
// Même contrat d'accessibilité que <Input> (label associé, aria-describedby,
// aria-invalid, bordure danger en erreur) et mêmes tokens de champ — le
// multi-lignes n'était pas couvert par le composant Input.
// ---------------------------------------------------------------------------

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  labelClassName?: string | undefined
  /** Message d'erreur : bascule le champ en état invalide. */
  error?: string | undefined
}

export function Textarea({ label, labelClassName, error, id, className, ...props }: TextareaProps) {
  const autoId = useId()
  const areaId = id ?? autoId
  const errorId = `${areaId}-error`

  return (
    <div>
      <label
        htmlFor={areaId}
        className={`block text-sm font-medium text-ink ${labelClassName ?? ''}`}
      >
        {label}
      </label>
      <textarea
        id={areaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          'mt-1.5 w-full rounded-sm border-[1.5px] bg-surface px-3 py-2 text-sm text-ink',
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
