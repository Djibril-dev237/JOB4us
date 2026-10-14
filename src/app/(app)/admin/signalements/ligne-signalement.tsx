import type { StatutSignalement } from '@prisma/client'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { libelleStatutSignalement } from '@/lib/messagerie-labels'

import { FORMATEUR_DATE, extrait } from './affichage'

// ─── Ligne de la liste admin des signalements (M8, Vague 3) ──────────────────
// Motif des lignes de admin/offres/ligne-offre.tsx : composant LOCAL, rendu
// SERVEUR pur (la liste est en lecture seule : AUCUNE action ici, seul le
// détail permet de clôturer).
//
// Le MOTIF est le lien vers le détail (aucun libellé « Voir » à inventer) :
// le texte du lien EST la donnée qui décrit la ligne, ce qui préserve la
// règle « aucun texte affiché hors TEXTES ».
//
// Responsiveness 360/768/1280 : `min-w-0` + `basis-64` (le bloc d'infos
// grandit puis passe à la ligne sous 360 px), badge à droite en `shrink-0`
// — aucun défilement horizontal.
// ---------------------------------------------------------------------------

/** Longueurs d'extrait (points de code) : la ligne reste lisible à 360 px. */
const LONGUEUR_EXTRAIT_MOTIF = 120
const LONGUEUR_EXTRAIT_MESSAGE = 160

export interface SignalementLigne {
  id: number
  motif: string
  statut: StatutSignalement
  createdAt: Date
  auteurNom: string
  messageExtrait: string
}

interface LigneSignalementProps {
  signalement: SignalementLigne
}

export function LigneSignalement({ signalement }: LigneSignalementProps) {
  return (
    <li className="flex flex-wrap items-start gap-3 p-3">
      <div className="min-w-0 grow basis-64">
        {/* h2 : hiérarchie continue depuis le h1 de la page (motif M6). */}
        <h2 className="min-w-0 break-words text-sm font-semibold text-ink">
          <Link
            href={`/admin/signalements/${signalement.id}`}
            className="transition-colors duration-fast hover:text-brand"
          >
            {extrait(signalement.motif, LONGUEUR_EXTRAIT_MOTIF)}
          </Link>
        </h2>

        {/* Extrait du message signalé : texte brut échappé par React. */}
        <p className="mt-1 min-w-0 break-words text-sm text-ink-muted">
          {extrait(signalement.messageExtrait, LONGUEUR_EXTRAIT_MESSAGE)}
        </p>

        {/* Auteur du signalement + date de création (motif de date M6). */}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
          <span className="min-w-0 break-words">{signalement.auteurNom}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={signalement.createdAt.toISOString()}>
            {FORMATEUR_DATE.format(signalement.createdAt)}
          </time>
        </p>
      </div>

      {/* Statut via la source unique libelleStatutSignalement — la variante
          de teinte est une décision de RENDU locale : « ouvert » appelle
          l'attention (warn), « traité » est un état terminal passif. */}
      <div className="ml-auto shrink-0">
        <Badge variant={signalement.statut === 'ouvert' ? 'warn' : 'neutral'}>
          {libelleStatutSignalement(signalement.statut)}
        </Badge>
      </div>
    </li>
  )
}
