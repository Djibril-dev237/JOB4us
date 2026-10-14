'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { bloquerUtilisateur, debloquerUtilisateur, masquerConversation } from '@/app/actions/messagerie'
import { Button, buttonClassName } from '@/components/ui/button'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── Actions sur une conversation (M8, Vague 2 → Vague 3) ────────────────────
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
// Blocage (Vague 3) : `window.confirm` (la confirmation rappelle la PORTÉE
// globale du blocage, cf. TEXTES.confirmationBlocage) →
// `bloquerUtilisateur`/`debloquerUtilisateur` (idempotentes) →
// `router.refresh()` : le verdict serveur (bandeau, bascule du bouton en
// « Débloquer », composer retiré) vient de la RSC relue, jamais d'un état
// local — un seul rafraîchissement, aucune vérité dupliquée côté client.
// Le menu RESTE OUVERT en cas d'échec : c'est lui qui porte le message
// d'erreur (role="alert"), le fermer rendrait `TEXTES.actionEchouee`
// invisible. Le bouton `Signaler` du fil, lui, n'est jamais masqué : la
// modération reste accessible même bloqué ou en lecture seule.
// ---------------------------------------------------------------------------

export interface ActionsConversationProps {
  conversationId: number
  autreUserId: number
  autreNom: string
  /**
   * VRAI si MOI j'ai bloqué l'interlocuteur : le bouton affiche alors
   * `TEXTES.debloquer` (une seule entrée Bloquer/Débloquer, jamais deux
   * boutons contradictoires). Forwardé par la page via `EnTeteConversation`
   * (Vague 3) — la vérité du blocage reste celle de la RSC.
   */
  bloqueeParMoi: boolean
}

export function ActionsConversation({
  conversationId,
  autreUserId,
  autreNom,
  bloqueeParMoi,
}: ActionsConversationProps) {
  const router = useRouter()
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
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

  async function basculerBlocage(): Promise<void> {
    // Une seule entrée Bloquer/Débloquer : la confirmation et l'action
    // suivent l'état RÉEL servi par la page (`bloqueeParMoi`), jamais une
    // bascule locale optimistic — le serveur est la seule vérité.
    const confirmation = bloqueeParMoi ? TEXTES.confirmationDeblocage : TEXTES.confirmationBlocage
    if (!window.confirm(confirmation)) return
    setEnCours(true)
    setErreur(null)
    try {
      const resultat = bloqueeParMoi
        ? await debloquerUtilisateur(autreUserId)
        : await bloquerUtilisateur(autreUserId)
      if (!resultat.ok) {
        // Échec (panne DB, session perdue) : le menu reste ouvert pour
        // afficher l'alerte — aucun état local ne prétend avoir bloqué.
        setErreur(TEXTES.actionEchouee)
        return
      }
      setOuvert(false)
      // La page relue recalcule le verdict serveur (bandeau « écriture
      // bloquée », bouton Débloquer, composer retiré) — UNE seule source.
      router.refresh()
    } catch {
      // Panne réseau / action indisponible : même verdict, jamais
      // d'exception qui propage depuis un gestionnaire de clic.
      setErreur(TEXTES.actionEchouee)
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
        onClick={() => {
          // Une alerte d'échec ne doit pas SURVIVRE à la fermeture du menu :
          // `role="alert"` réaffiché à la réouverture sans nouvel échec
          // annoncerait une panne qui n'a pas eu lieu.
          setErreur(null)
          setOuvert((valeur) => !valeur)
        }}
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

          {/* Blocage / déblocage : une SEULE entrée, libellé piloté par
              l'état serveur. Désactivé pendant l'appel uniquement (le
              double-clic ne doit pas déclencher deux écritures en vol). */}
          <Button
            type="button"
            role="menuitem"
            variant="secondary"
            size="sm"
            onClick={() => void basculerBlocage()}
            disabled={enCours}
            className="w-full justify-start border-0 bg-surface px-3 text-left hover:bg-surface-alt"
          >
            {bloqueeParMoi ? TEXTES.debloquer : TEXTES.bloquer}
          </Button>

          {/* Échec du blocage/déblocage : verbatim TEXTES, annoncé par
              role="alert" — le menu reste ouvert, c'est lui qui porte le
              message. */}
          <p role="alert" className="min-w-0 px-3 pt-1 text-sm text-danger">
            {erreur ?? ''}
          </p>
        </div>
      ) : null}
    </div>
  )
}
