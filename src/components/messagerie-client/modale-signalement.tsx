'use client'

import { useEffect, useRef, useState } from 'react'

import { signalerMessage } from '@/app/actions/messagerie'
import { IconClose } from '@/components/icons'
import { Button, buttonClassName } from '@/components/ui/button'
import { LONGUEUR_MAX_MOTIF, nettoyerMotif } from '@/lib/messagerie-contenu'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import { TEXTES } from '@/lib/messagerie-labels'

// ─── Modale de signalement d'un message (M8, Vague 2 → Vague 3) ──────────────
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
// ENVOI (Vague 3) : `signalerMessage({ messageId, motif })`. Deux issues
// TERMINALES non exclusives l'une de l'autre côté utilisateur —
// `signalementEnvoye` (nouveau signalement) et `signalementDejaFait`
// (doublon absorbé par la clé unique) — remplacent le contenu de la
// modale, AVEC un bouton `TEXTES.fermer` : pas de setTimeout, pas
// d'auto-fermeture (fermer tout seul dépossède l'utilisateur du verdict
// et vole le focus sans restituer). En ÉCHEC, le textarea EST CONSERVÉ
// (motif perdu = devoir tout retaper) et l'erreur s'affiche en inline.
//
// La modale reste atteignable depuis le fil MÊME en conversation bloquée
// ou en lecture seule (soupape de modération) : le bouton `Signaler` du
// fil n'est jamais masqué, et ce composant n'en teste jamais le blocage.
// ---------------------------------------------------------------------------

interface ModaleSignalementProps {
  message: MessageAffiche
  /** Fermeture de la modale (le composant appelant restitue le focus). */
  onFermer: () => void
}

export function ModaleSignalement({ message, onFermer }: ModaleSignalementProps) {
  const [motif, setMotif] = useState('')
  const [enEnvoi, setEnEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // Issue terminale du signalement : `null` = formulaire encore affiché.
  const [verdict, setVerdict] = useState<'transmis' | 'deja' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const boutonFermerRef = useRef<HTMLButtonElement>(null)
  const boutonConfirmerRef = useRef<HTMLButtonElement>(null)

  // Piège de focus minimal : Échap ferme, Tab circule entre les SEULS
  // éléments focusables du verdict courant (textarea + boutons) — la liste
  // est filtrée car le formulaire disparaît au profit du verdict terminal.
  useEffect(() => {
    textareaRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onFermer()
        return
      }
      if (event.key !== 'Tab') return
      // Prédicat sur l'union RÉELLE du tableau : `HTMLElement` n'est pas
      // assignable au paramètre (propriétés que ni le textarea ni les
      // boutons n'ont) — le prédicat doit cibler l'union exacte.
      const focusables = [
        textareaRef.current,
        boutonConfirmerRef.current,
        boutonFermerRef.current,
      ].filter(
        (element): element is HTMLTextAreaElement | HTMLButtonElement => element !== null,
      )
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

  // Verdict terminal : le focus ne peut PAS rester sur un textarea qui
  // disparaît (il retomberait sur <body>, hors du piège) — on le confie au
  // bouton `Fermer` du verdict, l'issue à laquelle l'utilisateur s'attend
  // après avoir lu le message.
  useEffect(() => {
    if (verdict !== null) {
      boutonConfirmerRef.current?.focus()
    }
  }, [verdict])

  async function envoyer(): Promise<void> {
    // Double-clic bloqué pendant l'envoi : un seul signalement en vol.
    if (enEnvoi) return
    setEnEnvoi(true)
    setErreur(null)
    try {
      // Le motif a déjà été nettoyé à la saisie (nettoyerMotif) ; l'action
      // rejoue le même pipeline côté serveur — pare-chocs Zod + nettoyage.
      const resultat = await signalerMessage({ messageId: message.id, motif })
      if (resultat.ok) {
        // Issue terminale : le contenu devient le verdict (aucune
        // auto-fermeture, l'utilisateur ferme quand il a lu). `deja` n'est
        // PAS une erreur : le signalement existe, la file de modération est
        // déjà alimentée.
        setVerdict(resultat.deja ? 'deja' : 'transmis')
        return
      }
      // 'inconnue' : le textarea EST CONSERVÉ — rien n'est perdu, on
      // réessaie d'un clic.
      setErreur(TEXTES.signalementEchoue)
    } catch {
      // Panne réseau / action indisponible : même conservation du motif.
      setErreur(TEXTES.signalementEchoue)
    } finally {
      setEnEnvoi(false)
    }
  }

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

        {verdict !== null ? (
          // Issue terminale : le formulaire cède la place au verdict, AVEC
          // son bouton Fermer (pas d'auto-fermeture). `role="status"` et non
          // `alert` : ce n'est pas une erreur, c'est l'aboutissement voulu.
          <>
            <p role="status" className="mt-3 min-w-0 text-sm text-ink">
              {verdict === 'deja' ? TEXTES.signalementDejaFait : TEXTES.signalementEnvoye}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              {/* Bouton natif (et non `Button`) : il porte une RÉFÉRENCE
                  pour le focus du verdict — le composant `Button` n'en
                  transmet pas. */}
              <button
                ref={boutonConfirmerRef}
                type="button"
                onClick={onFermer}
                className={buttonClassName('secondary')}
              >
                {TEXTES.fermer}
              </button>
            </div>
          </>
        ) : (
          <>
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

            {/* Échec en INLINE au-dessus des boutons : le textarea est
                CONSERVÉ (motif intact), role="alert" annonce la panne. */}
            <p role="alert" className="mt-2 min-w-0 text-sm text-danger">
              {erreur ?? ''}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={onFermer}>
                {TEXTES.fermer}
              </Button>
              {/* Envoi réel (Vague 3) : disabled pendant l'appel et sur un
                  motif vide — un signalement sans motif n'a aucune valeur
                  pour la modération, autant ne pas encombrer la file. */}
              <Button
                variant="primary"
                onClick={() => void envoyer()}
                disabled={enEnvoi || motif.trim().length === 0}
              >
                {TEXTES.signaler}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
