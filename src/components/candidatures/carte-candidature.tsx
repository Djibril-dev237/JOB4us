'use client'

import Link from 'next/link'

import { retirerCandidature } from '@/app/actions/candidatures'
import { Badge } from '@/components/ui/badge'
import { Button, buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  LIBELLES_STATUT,
  STATUTS_TERMINAUX,
  VARIANTE_STATUT,
} from '@/lib/candidatures-labels'
import type { CandidatureCandidat } from '@/lib/candidatures-dal'
import { TYPE_CONTRAT_LABELS } from '@/lib/definitions'

// ─── Carte d'une liste de candidatures CÔTÉ CANDIDAT (M7) ────────────────────
//
// Composant CLIENT (un <form action> y est branché) appelé depuis une page
// serveur — aucun état local : tout arrive dans la prop, déjà dérivé par le
// DTO `CandidatureCandidat` (liste blanche du DAL, y compris `offreRetiree`).
//
// Rendu : badge statut (variante M7, jamais recopiée), titre de l'offre
// LIÉ quand elle est encore consultable, rappel entreprise / ville /
// contrat / date de création (motif de date M6), extrait de lettre (120
// caractères, déjà troncé par le DAL) et actions : retirer (form + action)
// tant que le statut le permet, sinon rien ; « Voir le détail » vers la
// fiche de suivi.
//
// Offre retirée : plus de lien (le slug ne mènerait plus à rien de
// consultable), mention explicite en opacité faible — mais la ligne de
// candidature, elle, reste.
// ---------------------------------------------------------------------------

/**
 * Date de création en « JJ/MM/AAAA », fuseau de la cible — motif M6 repris
 * à l'identique (carte-offre.tsx) : formateur local, `Intl` ne serait pas
 * partageable sans modifier un fichier hors mission, et afficher dans le
 * fuseur du serveur décalerait d'un jour aux bornes de minuit.
 */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export interface CarteCandidatureProps {
  candidature: CandidatureCandidat
}

export function CarteCandidature({ candidature }: CarteCandidatureProps) {
  const { id, statut, createdAt, lettreExtrait, offre, offreRetiree } = candidature

  // Retrait réservé aux statuts encore ouverts : terminaux (acceptée,
  // refusée, retirée) et `retiree` déjà excluent le bouton.
  const retirable = !STATUTS_TERMINAUX.includes(statut) && statut !== 'retiree'
  // Titre lié UNIQUEMENT si l'offre est encore consultable (slug présent et
  // non retirée) — sinon le même titre en texte simple, aucun lien mort.
  const hrefOffre = !offreRetiree && offre.slug !== null ? `/offres/${offre.slug}` : null

  return (
    <Card className="transition-shadow duration-fast hover:border-line-strong hover:shadow-lift">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            {/* h2 et non h3 : hiérarchie continue depuis le h1 de la page. */}
            <h2 className="text-sm font-bold text-ink">
              {hrefOffre !== null ? (
                <Link
                  href={hrefOffre}
                  className="transition-colors duration-fast hover:text-brand"
                >
                  {offre.titre}
                </Link>
              ) : (
                offre.titre
              )}
            </h2>
            <Badge variant={VARIANTE_STATUT[statut]}>{LIBELLES_STATUT[statut]}</Badge>
          </div>

          <p className="mt-1 text-sm font-semibold text-ink">{offre.nomEntreprise}</p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{offre.ville}</span>
            <span aria-hidden="true">·</span>
            <span>{TYPE_CONTRAT_LABELS[offre.typeContrat]}</span>
            <span aria-hidden="true">·</span>
            <span>{FORMATEUR_DATE.format(createdAt)}</span>
          </p>

          {offreRetiree ? (
            <p className="mt-1 text-sm text-ink-muted opacity-60">Offre retirée du site</p>
          ) : null}

          {lettreExtrait !== null ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{lettreExtrait}</p>
          ) : null}
        </div>

        {/* Actions : wrap, la carte reste lisible sous 360 px. */}
        <div className="flex flex-wrap items-center gap-2">
          {retirable ? (
            <form action={retirerCandidature}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="danger" size="sm">
                Retirer ma candidature
              </Button>
            </form>
          ) : null}

          <Link
            href={`/candidat/candidatures/${id}`}
            className={buttonClassName('secondary', 'sm')}
          >
            Voir le détail
          </Link>
        </div>
      </div>
    </Card>
  )
}
