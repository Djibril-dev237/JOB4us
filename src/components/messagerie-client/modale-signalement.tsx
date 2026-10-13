'use client'

import { useEffect, useRef, useState } from 'react'

import { IconClose } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { LONGUEUR_MAX_MOTIF, nettoyerMotif } from '@/lib/messagerie-contenu'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── Modale de signalement d'un message (M8, Vague 2) ────────────────────────
//
// Sans lib externe : div role="dialog" + aria-modal, focus piège MINIMAL
// (le focus entre à l'ouverture et ne sort pas au Tab), fermeture par
// Échap / clic sur le fond / bouton fermer.
//
// Le motif est nettoyé À LA SAISIE par `nettoyerMotif` (le même pipeline
// serveur) : le champ ne peut pas accumuler de balises ou de contrôles
// entre deux frappes, et reste borné à LONGUEUR_MAX_MOTIF. Le schema Zod
// serveur reste le pare-chocs définitif à l'envoi.
//
// ENVOI : l'action de signalement arrive en Vague 3 — le bouton est
// désactivé aujourd'hui, AUCUNE action n'est créée ici.
// ---------------------------------------------------------------------------

interface ModaleSignalementProps {
  message: MessageAffiche
  /** Fermeture de la modale (le composant appelant restitue le focus). */
  onFermer: () => void
}

export function ModaleSignalement({ message, onFermer }: ModaleSignalementProps) {
  const [motif, setMotif] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const boutonFermerRef = useRef<HTMLButtonElement>(null)

  // Piège de focus minimal : Échap ferme, Tab circule entre les deux
  // seuls éléments focusables (textarea + bouton fermer).
  useEffect(() => {
    textareaRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onFermer()
        return
      }
      if (event.key !== 'Tab') return
      const focusables = [textareaRef.current, boutonFermerRef.current]
      const elementActif = document.activeElement
      const index = focusables.findIndex((element) => element === elementActif)
      if (index === -1) return
      event.preventDefault()
      const suivant = event.shiftKey
        ? (index - 1 + focusables.length) % focusables.length
        : (index + 1) % focusables.length
      focusables[suivant]?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onFermer])

  return (
    // Fond : clic = fermeture (le clic DANS la boîte ne remonte pas ici).
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onFermer()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-modale-signalement"
        className="w-full max-w-md rounded-md border border-line bg-surface p-4 shadow-lift"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2 id="titre-modale-signalement" className="min-w-0 text-base font-bold text-ink">
            {TEXTES.signaler}
          </h2>
          <button
            ref={boutonFermerRef}
            type="button"
            aria-label={TEXTES.fermer}
            onClick={onFermer}
            className="rounded-sm p-1 text-ink-muted transition-colors duration-fast hover:bg-surface-alt hover:text-ink"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Message signalé affiché en LECTURE SEULE : texte brut, jamais
            d'HTML — React échappe toute interpolation. */}
        <blockquote className="mt-3 min-w-0 rounded-sm border border-line bg-surface-alt px-3 py-2">
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
            {message.contenu}
          </p>
        </blockquote>

        <textarea
          ref={textareaRef}
          value={motif}
          aria-label={TEXTES.signaler}
          maxLength={LONGUEUR_MAX_MOTIF}
          onChange={(event) => setMotif(nettoyerMotif(event.target.value))}
          className={[
            'mt-3 w-full rounded-sm border-[1.5px] border-line bg-surface px-3 py-2 text-sm text-ink',
            'placeholder:text-ink-muted transition-colors duration-fast focus:border-brand',
          ].join(' ')}
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onFermer}>
            {TEXTES.fermer}
          </Button>
          {/* TODO Vague 3 : action de signalement (messageId + motif) — le
              bouton reste désactivé tant que l'action n'existe pas, AUCUNE
              action n'est créée dans cette Vague. */}
          <Button variant="primary" disabled>
            {TEXTES.signaler}
          </Button>
        </div>
      </div>
    </div>
  )
}
