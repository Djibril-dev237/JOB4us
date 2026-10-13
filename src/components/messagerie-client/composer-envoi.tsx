'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { envoyerMessage } from '@/app/actions/messagerie'
import { IconSend } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { LONGUEUR_MAX_MESSAGE } from '@/lib/messagerie-contenu'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import { TEXTES } from '@/lib/messagerie-labels'
import { EVENEMENT_MESSAGE_ENVOYE } from '@/lib/souscription'

// ─── Composer d'envoi de message (M8, Vague 2) ───────────────────────────────
//
// Composant CLIENT, interface FIGÉE avec SA-5 (`<ComposerEnvoi
// conversationId>` seul : la page décide de le rendre, le composant n'a
// pas à connaître la conversation ni les participants).
//
// Contrôles :
//  * textarea auto-grow 1 → 4 lignes (hauteur pilotée par scrollHeight,
//    plafonnée — au-delà, `overflow-y-auto` prend le relais) ;
//  * compteur APPARAISSANT à partir de 1600 caractères (LONGUEUR_MAX_MESSAGE
//    sert de borne VISIBLE ; le schema Zod serveur, plus permissif sur la
//    garde brute, reste le pare-chocs) — au-delà de 2000, le compte est
//    négatif, en danger, l'envoi est désactivé ;
//  * Enter = envoyer, Shift+Enter = saut de ligne, IME respecté
//    (`isComposing` : sans ce garde, la validation d'une saisie japonaise
//    ou coréenne envoie le texte à moitié composé) ;
//  * envoi optimiste : la bulle « en attente » occupe la place pendant
//    l'appel, remplacée par la réponse serveur ; le textarea n'est vidé
//    QUE sur `{ ok: true }` (un échec conserve le texte de l'utilisateur —
//    « Réessayer » = remettre Envoyer, rien n'est perdu) ;
//  * échec serveur : `role="alert"` pour l'annonce, verbatim TEXTES ;
//    bascule lecture seule / blocage → UN SEUL reload (le bandeau vient
//    du serveur, recharger en boucle figerait l'écran).
// ---------------------------------------------------------------------------

/** Seuil d'apparition du compteur (borne visible avant la limite). */
const SEUIL_COMPTEUR = 1600

/** Hauteur d'une ligne (px) : 4 lignes max avant scroll interne. */
const HAUTEUR_LIGNE_PX = 24
const LIGNES_MAX = 4

export interface ComposerEnvoiProps {
  conversationId: number
}

export function ComposerEnvoi({ conversationId }: ComposerEnvoiProps) {
  const [texte, setTexte] = useState('')
  const [enAttente, setEnAttente] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enEnvoi, setEnEnvoi] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rechargeeRef = useRef(false)

  // Auto-grow : la hauteur suit le contenu jusqu'à LIGNES_MAX lignes.
  useEffect(() => {
    const element = textareaRef.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, LIGNES_MAX * HAUTEUR_LIGNE_PX)}px`
  }, [texte])

  const longueur = Array.from(texte).length
  const reste = LONGUEUR_MAX_MESSAGE - longueur
  const tropLong = reste < 0
  const compteurVisible = longueur >= SEUIL_COMPTEUR

  const envoyer = useCallback(async () => {
    // Double-Enter bloqué pendant l'envoi : un seul message en vol.
    if (enEnvoi) return
    if (texte.trim().length === 0 || tropLong) return

    setEnEnvoi(true)
    setErreur(null)
    // Bulle « en attente » : opacité + aria-busy, remplacée par la réponse.
    setEnAttente(texte)
    try {
      const resultat = await envoyerMessage({ conversationId, contenu: texte })
      if (resultat.ok) {
        // Le message confirmé part AU FIL avant l'effacement de
        // l'optimiste (couture locale CustomEvent : les interfaces figées
        // interdisent un état partagé entre composants) : aucune
        // « disparition » entre la confirmation et la trame de polling
        // suivante — le fil dé-dédoublonne par id.
        window.dispatchEvent(
          new CustomEvent<MessageAffiche>(EVENEMENT_MESSAGE_ENVOYE, { detail: resultat.message }),
        )
        // Reset UNIQUEMENT sur succès : rien n'est perdu en cas d'échec.
        setTexte('')
        setEnAttente(null)
        return
      }
      setEnAttente(null)
      switch (resultat.erreur) {
        case 'debit':
          setErreur(TEXTES.tropDeMessages)
          return
        case 'lecture-seule':
        case 'bloquee':
          // Le motif exact (statut terminal vs blocage) est une affaire de
          // RSC : on affiche le texte commun et on recharge UNE fois pour
          // que le bandeau serveur prenne la main.
          setErreur(TEXTES.ecritureBloquee)
          if (!rechargeeRef.current) {
            rechargeeRef.current = true
            window.location.reload()
          }
          return
        default:
          // 'taille' | 'inconnue' : le texte saisi RESTE dans le textarea,
          // « Réessayer » = remettre Envoyer.
          setErreur(TEXTES.envoiEchoue)
          return
      }
    } catch {
      // Panne réseau / action indisponible : même conservation du texte.
      setEnAttente(null)
      setErreur(TEXTES.envoiEchoue)
    } finally {
      setEnEnvoi(false)
    }
  }, [conversationId, enEnvoi, texte, tropLong])

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    // Saisie IME en cours : Enter = validation de composition, pas envoi.
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void envoyer()
  }

  return (
    <div className="min-w-0 rounded-md border border-line bg-surface p-2">
      {/* Envoi optimiste : la bulle tient la place pendant l'appel. */}
      {enAttente !== null ? (
        <div
          aria-busy="true"
          className="mb-2 ml-auto min-w-0 max-w-[85%] rounded-md border border-brand-tint bg-brand-tint px-3 py-2 opacity-60"
        >
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">{enAttente}</p>
        </div>
      ) : null}

      <div className="flex min-w-0 items-end gap-2">
        <textarea
          ref={textareaRef}
          value={texte}
          rows={1}
          placeholder={TEXTES.placeholderMessage}
          onChange={(event) => setTexte(event.target.value)}
          onKeyDown={onKeyDown}
          className={[
            'min-w-0 flex-1 resize-none rounded-sm border-[1.5px] border-line bg-surface px-3 py-2 text-sm text-ink',
            'placeholder:text-ink-muted transition-colors duration-fast focus:border-brand',
          ].join(' ')}
        />
        <Button
          type="button"
          aria-label={TEXTES.envoyer}
          onClick={() => void envoyer()}
          disabled={enEnvoi || tropLong || texte.trim().length === 0}
        >
          <IconSend size={18} />
        </Button>
      </div>

      <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
        <div role="alert" className="min-w-0 text-sm text-danger">
          {erreur ?? ''}
        </div>
        {compteurVisible ? (
          <span
            className={`shrink-0 text-xs ${tropLong ? 'font-semibold text-danger' : 'text-ink-muted'}`}
          >
            {reste}
          </span>
        ) : null}
      </div>
    </div>
  )
}
