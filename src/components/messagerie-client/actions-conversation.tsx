'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { masquerConversation } from '@/app/actions/messagerie'
import { Button, buttonClassName } from '@/components/ui/button'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── Actions sur une conversation (M8, Vague 2) ──────────────────────────────
//
// Composant CLIENT, interface FIGÉE avec SA-5. Menu sans lib externe :
// état `ouvert` + fermeture par Escape (retour du focus au bouton), clic
// extérieur et activation — même comportement que le menu profil
// (avatar-menu.tsx), avec `role="menu"`/`role="menuitem"` en plus pour
// l'énoncé des actions.
//
// Masquage : `window.confirm` (le legacy confirmait aussi) →
// `masquerConversation` (action SA-4, idempotente, masque de MON côté
// seulement) → retour à la liste.
//
// Blocage : action Vague 3 — le bouton est désactivé, AUCUNE action n'est
// inventée ici (TODO commenté ci-dessous).
// ---------------------------------------------------------------------------

export interface ActionsConversationProps {
  conversationId: number
  autreUserId: number
  autreNom: string
}

// Interface FIGÉE : `autreUserId` n'est PAS déstructuré aujourd'hui — il
// servira à l'action de blocage de la Vague 3 (bloquerConversation), qui
// n'existe pas encore.
export function ActionsConversation({
  conversationId,
  autreNom,
}: ActionsConversationProps) {
  const router = useRouter()
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const conteneurRef = useRef<HTMLDivElement>(null)
  const boutonRef = useRef<HTMLButtonElement>(null)

  // Fermeture par Escape + retour du focus sur le bouton.
  useEffect(() => {
    if (!ouvert) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOuvert(false)
        boutonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ouvert])

  // Fermeture par clic extérieur (pointerdown : le menu ne doit pas
  // survivre à un ailleurs, y compris la molette).
  useEffect(() => {
    if (!ouvert) return
    function onPointerDown(event: PointerEvent) {
      if (conteneurRef.current && !conteneurRef.current.contains(event.target as Node)) {
        setOuvert(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [ouvert])

  async function masquer(): Promise<void> {
    setOuvert(false)
    if (!window.confirm(TEXTES.confirmationMasquage)) return
    setEnCours(true)
    try {
      await masquerConversation(conversationId)
      // Le masque est posé de mon côté uniquement : l'autre participant
      // ne voit rien changer. Retour à la liste.
      router.push('/messages')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div ref={conteneurRef} className="relative self-stretch">
      <button
        ref={boutonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => setOuvert((valeur) => !valeur)}
        className={[
          buttonClassName('secondary', 'sm'),
          // Le déclencheur reprend la bordure/hauteur du bouton du header.
          'h-9 max-w-40 border-line-strong bg-surface px-3',
        ].join(' ')}
      >
        <span className="truncate">{autreNom}</span>
      </button>

      {ouvert ? (
        <div
          role="menu"
          aria-label={autreNom}
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-md border border-line bg-surface p-2 shadow-lift"
        >
          <Button
            type="button"
            role="menuitem"
            variant="secondary"
            size="sm"
            onClick={() => void masquer()}
            disabled={enCours}
            className="w-full justify-start border-0 bg-surface px-3 text-left hover:bg-surface-alt"
          >
            {TEXTES.masquer}
          </Button>

          {/* TODO Vague 3 : bloquer l'interlocuteur (action + confirmation
              serveur) — désactivé tant que l'action n'existe pas, ne pas
              en inventer une. */}
          <Button
            type="button"
            role="menuitem"
            variant="secondary"
            size="sm"
            disabled
            className="w-full justify-start border-0 bg-surface px-3 text-left hover:bg-surface-alt"
          >
            {TEXTES.bloquer}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
