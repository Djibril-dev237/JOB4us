'use client'

import type { StatutCandidature } from '@prisma/client'

import { changerStatutCandidature } from '@/app/actions/candidatures'
import { buttonClassName } from '@/components/ui/button'
import { LIBELLES_STATUT, transitionsAutorisees } from '@/lib/candidatures-labels'

// ─── Transitions de statut côté RECRUTEUR (M7 — seul ilot client des listes) ──
//
// UN SEUL comportement client : soumettre un changement de statut. Le choix
// des cibles, les libellés et la matrice restent côté serveur — la liste des
// boutons est lue dans `transitionsAutorisees(statut, 'recruteur')`
// (src/lib/candidatures-labels.ts), JAMAIS recopiée ici : ajouter un état à
// la matrice T1-T11 ajoute automatiquement le bouton correspondant, et une
// cible interdite ne peut pas apparaître.
//
// EXCLUSION `consultee` (décision d'intégration M7) : le passage
// « Envoyée → Consultée » est une cible AUTO-SERVEUR, déclenchée par
// l'ouverture de la fiche (`marquerConsultee`, appelée par la PAGE
// /recruteur/candidatures/[id] et par la page
// /recruteur/offres/[id]/candidatures quand son panneau est ouvert).
// L'acteur de ce passage est le serveur, jamais un bouton : `consultee`
// est donc filtrée des cibles affichées ci-dessous, et aucun formulaire
// client ne peut proposer « Marquer : Consultée ».
//
// Idempotence : PAS de JS de double-clic (ni disabled, ni état pending
// maison). L'action serveur fait un compare-and-set sur le statut courant
// : un second envoi de la même cible est refusé par la matrice (redirect
// `?erreur=transition`), jamais par un verrou côté client.
//
// Aucune écriture ici : ce module n'envoie que des formulaires vers
// `changerStatutCandidature` (@/app/actions/candidatures), qui re-valide
// rôle, ownership et transition côté serveur.
// ---------------------------------------------------------------------------

interface TransitionsCandidatureProps {
  /** Id de la ligne, transmis par un input caché (jamais dans l'URL). */
  candidatureId: number
  /** Statut COURANT : seules les cibles autorisées depuis lui sont rendues. */
  statut: StatutCandidature
}

export function TransitionsCandidature({
  candidatureId,
  statut,
}: TransitionsCandidatureProps) {
  // Matrice importée, défensivement copiée par le DAL de libellés — et
  // uniquement elle. `consultee` est retirée : cible auto-serveur (ci-dessus).
  const cibles = transitionsAutorisees(statut, 'recruteur').filter(
    (cible) => cible !== 'consultee',
  )

  // Aucune transition possible (statut terminal pour le recruteur, ex.
  // « Retirée ») : rien n'est rendu, pas de conteneur vide ni de bouton inactif.
  if (cibles.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {cibles.map((cible) => (
        <form key={cible} action={changerStatutCandidature} className="inline-flex">
          {/* Cible de la transition : champ CACHÉ, jamais saisi ni cliquable
              dans l'URL — l'action la re-valide contre la matrice. */}
          <input type="hidden" name="id" value={String(candidatureId)} />
          <input type="hidden" name="vers" value={cible} />
          <button type="submit" className={buttonClassName('secondary', 'sm')}>
            {`Marquer : ${LIBELLES_STATUT[cible]}`}
          </button>
        </form>
      ))}
    </div>
  )
}
