import Link from 'next/link'

import { IconBriefcase } from '@/components/icons'
import { StatutBadge } from '@/components/offres/statut-badge'
import { buttonClassName, type ButtonVariant } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cloturerOffre, dupliquerOffre, publierOffre, rouvrirOffre, supprimerOffre } from '@/app/actions/offres'
import { NIVEAU_EXPERIENCE_LABELS, TYPE_CONTRAT_LABELS } from '@/lib/definitions'
import { statutAffiche, type StatutAffiche } from '@/lib/offres-labels'
import type { OffreListe } from '@/lib/offres-dal'

import { BoutonActionOffre } from './bouton-action'
import { IconeCrayon, IconePoubelle } from './icones-offres'

// ─── Carte d'une offre du dashboard (D8) ─────────────────────────────────────
// Cartes empilées (une sous l'autre), parité sur le squelette du blade
// recruteur/offres/index.blade.php : icône briefcase, titre + badge, ligne
// de méta « ville · contrat · niveau · Expire le JJ/MM/AAAA », actions à
// droite (en dessous sous 360 px, via flex-wrap).
//
// D12 : le statut EST DÉRIVÉ ICI, côté serveur (statutAffiche), le badge ne
// fait qu'afficher. Le même dérivé pilote le jeu de boutons (matrice T1-T11) :
// brouillon → Publier ; publiée/expirée → Clôturer (T4 autorisé même sur une
// expirée) ; clôturée → Rouvrir ; suspendue → ni transition ni duplication
// (T6) — seulement Modifier et Supprimer. Dupliquer est retiré UNIQUEMENT
// d'une offre suspendue.
//
// Colonnes OMISES (M7) : candidatures (compteur + bouton « Candidatures ») —
// aucun lien mort vers /recruteur/offres/<id>, qui est 404 par contrat.
// ---------------------------------------------------------------------------

/**
 * Date d'expiration en « JJ/MM/AAAA », fuseau de la cible.
 * Local au module : `dateRelativeFr` (src/lib/dates.ts) ne produit que des
 * dates relatives et le formateur de la fiche publique est module-private —
 * impossible de les réutiliser sans modifier un fichier hors mission.
 * Fuseau Africa/Douala comme partout ailleurs (M5/M6) : afficher dans le
 * fuseau du serveur décalerait d'un jour aux bornes de minuit.
 */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** Transition recruteur possible depuis le statut AFFICHÉ (matrice T1-T11). */
interface TransitionCarte {
  libelle: string
  action: (formData: FormData) => Promise<void>
  variante: ButtonVariant
}

function transitionDe(affichage: StatutAffiche): TransitionCarte | null {
  switch (affichage) {
    case 'brouillon':
      // T2 : seul un brouillon se publie (D3 + D4 sont revérifiés en base).
      return { libelle: 'Publier', action: publierOffre, variante: 'primary' }
    case 'publiee':
    case 'expiree':
      // T4 : clôturer reste possible sur une publiée EXPIRÉE (fermer est
      // toujours bon) — « expirée » n'est qu'une dérivation de date.
      return { libelle: 'Clôturer', action: cloturerOffre, variante: 'secondary' }
    case 'cloturee':
      // T5 : rouvrir repasse en brouillon (jamais directement publiée).
      return { libelle: 'Rouvrir', action: rouvrirOffre, variante: 'secondary' }
    case 'suspendue':
      // T8/T9 : sanction admin — aucune transition recruteur, pas de T6.
      return null
  }
}

interface CarteOffreProps {
  offre: OffreListe
}

export function CarteOffre({ offre }: CarteOffreProps) {
  const affichage = statutAffiche(offre)
  const transition = transitionDe(affichage)
  const dupliquable = affichage !== 'suspendue'

  return (
    <Card className="transition-shadow duration-fast hover:border-line-strong hover:shadow-lift">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        {/* Vignette legacy (`.offre-icon`) : fond brand-tint, tokens M2. */}
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-brand-tint text-brand-dark"
        >
          <IconBriefcase />
        </span>

        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            {/* h2 et non h3 : hiérarchie continue depuis le h1 de la page
                (h1 → h2, pas de saut de niveau — même motif que la fiche). */}
            <h2 className="text-sm font-bold text-ink">{offre.titre}</h2>
            {/* D12 : dérivé côté serveur, le badge n'affiche que. */}
            <StatutBadge statut={affichage} />
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span>{offre.ville}</span>
            <span aria-hidden="true">·</span>
            <span>{TYPE_CONTRAT_LABELS[offre.typeContrat]}</span>
            <span aria-hidden="true">·</span>
            <span>{NIVEAU_EXPERIENCE_LABELS[offre.niveauExperience]}</span>
            <span aria-hidden="true">·</span>
            <span>Expire le {FORMATEUR_DATE.format(offre.dateExpiration)}</span>
          </p>
        </div>

        {/* Actions : wrap sous 360 px, la carte reste lisible. */}
        <div className="flex flex-wrap items-center gap-2">
          {transition !== null ? (
            <BoutonActionOffre
              action={transition.action}
              id={offre.id}
              libelle={transition.libelle}
              titre={transition.libelle}
              variante={transition.variante}
            />
          ) : null}

          {dupliquable ? (
            <BoutonActionOffre
              action={dupliquerOffre}
              id={offre.id}
              libelle="Dupliquer"
              titre="Dupliquer"
              variante="secondary"
            />
          ) : null}

          <Link
            href={`/recruteur/offres/${offre.id}/editer`}
            title="Modifier"
            aria-label="Modifier"
            className={buttonClassName('secondary', 'sm')}
          >
            <IconeCrayon />
          </Link>

          <BoutonActionOffre
            action={supprimerOffre}
            id={offre.id}
            libelle="Supprimer"
            titre="Supprimer"
            variante="danger"
            icone={<IconePoubelle />}
            confirmation="Supprimer cette offre ?"
          />
        </div>
      </div>
    </Card>
  )
}
