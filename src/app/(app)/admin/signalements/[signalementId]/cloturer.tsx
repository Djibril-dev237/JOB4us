'use client'

import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { StatutSignalement } from '@prisma/client'

import { traiterSignalement } from '@/app/actions/admin-messagerie'
import { Button } from '@/components/ui/button'
import { LONGUEUR_MAX_MOTIF, nettoyerMotif } from '@/lib/messagerie-contenu'
import { TEXTES } from '@/lib/messagerie-labels'

import { Bandeau } from '../bandeau'

// ─── Formulaire de clôture d'un signalement (M8, Vague 3) ────────────────────
//
// Composant CLIENT (l'action serveur `traiterSignalement` est appelée au
// clic, puis `router.refresh()` re-sert la page) rendu par le détail.
//
// Retours, tous résolus depuis TEXTES (aucun texte local) :
//  * `{ ok: true, deja: false }` → bandeau `signalementCloture` (succès) ;
//  * `{ ok: true, deja: true }`  → bandeau `signalementDejaCloture` ;
//  * refus / panne               → bandeau `actionEchouee` (erreur) SANS
//    effacer le formulaire ni la note saisie (« Réessayer » = rebasculer).
//
// APRÈS `router.refresh()`, le serveur re-rend le détail avec le statut
// `traite` : ce composant reste monté (la page le rend TOUJOURS, il décide
// de son propre rendu sur le statut + le retour courant), donc le bandeau
// de retour survit au rafraîchissement pendant que le bloc « traité »
// (note, modérateur, date) apparaît en dessous. Un signalement déjà traité
// à l'ouverture de la page ne rend AUCUN formulaire (retour null + statut
// `traite` → rien).
//
// Contrôles : nettoyage à la saisie via `nettoyerMotif` (même pipeline que
// le serveur, borne LONGUEUR_MAX_MOTIF), compteur de reste apparaissant à
// 80 % de la borne (motif du composer d'envoi), double-clic bloqué pendant
// l'appel. La note est OPTIONNELLE (un blanc pur part en `null`).
// ---------------------------------------------------------------------------

/** Seuil d'apparition du compteur (80 % de la borne, motif composer). */
const SEUIL_COMPTEUR = Math.floor(LONGUEUR_MAX_MOTIF * 0.8)

type Retour = 'cloture' | 'deja' | 'echec'

interface CloturerSignalementProps {
  signalementId: number
  statut: StatutSignalement
}

export function CloturerSignalement({ signalementId, statut }: CloturerSignalementProps) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [retour, setRetour] = useState<Retour | null>(null)

  const longueur = Array.from(note).length
  const reste = LONGUEUR_MAX_MOTIF - longueur
  const compteurVisible = longueur >= SEUIL_COMPTEUR

  function onChangeNote(event: ChangeEvent<HTMLTextAreaElement>): void {
    // Nettoyage À LA SAISIE : le champ ne peut pas accumuler de balises ni
    // de caractères de contrôle entre deux frappes (motif modale M8).
    setNote(nettoyerMotif(event.target.value))
  }

  async function cloturer(): Promise<void> {
    // Double-clic bloqué : une seule clôture en vol.
    if (enCours) return
    setEnCours(true)
    setRetour(null)
    try {
      const resultat = await traiterSignalement({
        signalementId,
        noteInterne: note.trim() === '' ? null : note,
      })
      if (resultat.ok) {
        setRetour(resultat.deja ? 'deja' : 'cloture')
        // Relecture serveur : le statut est maintenant `traite`, le détail
        // affiche note, modérateur et date sous le bandeau de retour.
        router.refresh()
        return
      }
      setRetour('echec')
    } catch {
      // Panne réseau / action indisponible : verdict identique, la saisie
      // est conservée.
      setRetour('echec')
    } finally {
      setEnCours(false)
    }
  }

  // Signalement déjà traité et aucun retour en cours : rien à rendre (le
  // bloc « traité » de la page porte l'information).
  if (retour === null && statut === 'traite') {
    return null
  }

  // Succès ou « déjà clôturé » : le bandeau remplace le formulaire.
  if (retour === 'cloture' || retour === 'deja') {
    return (
      <Bandeau
        variante="succes"
        message={retour === 'cloture' ? TEXTES.signalementCloture : TEXTES.signalementDejaCloture}
      />
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      {/* Échec : bandeau + formulaire INTACT (la note saisie n'est jamais
          perdue, doctrine M8 : un échec se corrige en réessayant). */}
      {retour === 'echec' ? <Bandeau variante="erreur" message={TEXTES.actionEchouee} /> : null}

      <div className="min-w-0 rounded-md border border-line bg-surface p-4">
        <label
          htmlFor="note-interne-signalement"
          className="block text-sm font-medium text-ink"
        >
          {TEXTES.noteInterne}
        </label>

        <textarea
          id="note-interne-signalement"
          value={note}
          rows={3}
          maxLength={LONGUEUR_MAX_MOTIF}
          onChange={onChangeNote}
          className={[
            'mt-2 w-full min-w-0 resize-y rounded-sm border-[1.5px] border-line bg-surface px-3 py-2 text-sm text-ink',
            'placeholder:text-ink-muted transition-colors duration-fast focus:border-brand',
          ].join(' ')}
        />

        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Button
            variant="primary"
            onClick={() => void cloturer()}
            disabled={enCours || reste < 0}
          >
            {TEXTES.cloturer}
          </Button>

          {compteurVisible ? (
            <span
              className={`shrink-0 text-xs ${reste < 0 ? 'font-semibold text-danger' : 'text-ink-muted'}`}
            >
              {reste}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
