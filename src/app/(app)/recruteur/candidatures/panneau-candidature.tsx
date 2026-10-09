import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LIBELLES_STATUT, VARIANTE_STATUT } from '@/lib/candidatures-labels'
import type { CandidatureRecruteurDetail } from '@/lib/candidatures-dal'
import { dateRelativeFr } from '@/lib/dates'

import { TransitionsCandidature } from './candidatures-recruteur'

// ─── Fiche d'une candidature, rendue en PANNEAU (M7, espace recruteur) ───────
//
// Composant SERVEUR PUR : aucune directive 'use client', ni hook, ni écriture.
// Seule l'interactivité est déléguée à `<TransitionsCandidature>` (ilot client
// des transitions, importé ci-dessus). Il sert DEUX contextes :
//  * le panneau collant de /recruteur/offres/[id]/candidatures (>= 1024 px) ;
//  * la fiche pleine largeur de /recruteur/candidatures/[id].
// Les props sont EXACTEMENT celles du DTO `CandidatureRecruteurDetail` :
// aucune donnée n'est relue ici (aucune requête, aucun accès session), la
// lettre complète et `cvSelectionne` ne sortent du DAL qu'en détail.
//
// Règle de données §2.5 : le panneau affiche nom, email, `titreProfil` et
// l'offre — jamais `resume`, `competences`, `dateNaissance`, ni le `cvPath`
// du PROFIL. Le fichier n'est joignable que par la route dédiée
// `/api/files/cv?candidature=<id>`, qui porte son propre contrôle
// d'appartenance et son journal (AccesFichier).
// ---------------------------------------------------------------------------

interface PanneauCandidatureProps {
  candidature: CandidatureRecruteurDetail
}

export function PanneauCandidature({ candidature }: PanneauCandidatureProps) {
  const { candidat, offre } = candidature

  return (
    <Card className="space-y-4">
      {/* Identité : nom (h2 = niveau sous le h1 de la page hôte), contact et
          ligne de contexte (profil · badge · date). Pas de champ absent : le
          profil sans intitulé affiche le tiret long « — ». */}
      <div>
        <h2 className="break-words text-lg font-bold tracking-tight text-ink">
          {candidat.nom}
        </h2>

        {candidat.email !== null ? (
          <a
            href={`mailto:${candidat.email}`}
            className="mt-1 inline-block break-all text-sm text-brand transition-colors duration-fast hover:text-brand-dark"
          >
            {candidat.email}
          </a>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <span>{candidat.titreProfil ?? '—'}</span>
          <span aria-hidden="true">·</span>
          <Badge variant={VARIANTE_STATUT[candidature.statut]}>
            {LIBELLES_STATUT[candidature.statut]}
          </Badge>
          <span aria-hidden="true">·</span>
          <time dateTime={candidature.createdAt.toISOString()}>
            {dateRelativeFr(candidature.createdAt)}
          </time>
        </div>
      </div>

      {/* Offre : lien vers la liste des candidatures de CETTE offre (l'historique
          survit à la suppression logique — le DAL ne filtre pas `deletedAt`),
          plus la mention explicite d'une offre retirée du site. */}
      <div className="break-words rounded-sm bg-surface-alt p-3 text-sm">
        <Link
          href={`/recruteur/offres/${offre.id}/candidatures`}
          className="font-medium text-ink transition-colors duration-fast hover:text-brand"
        >
          {offre.titre}
        </Link>
        {offre.deletedAt !== null ? (
          <p className="mt-1 text-ink-muted">Offre retirée du site</p>
        ) : null}
      </div>

      {/* Lettre de motivation COMPLÈTE (jamais tronquée en détail : l'extrait
          de 120 caractères ne sert qu'aux listes). Aucun texte libre produit
          pour une lettre absente — le bloc n'est pas rendu. */}
      {candidature.lettreMotivation !== null ? (
        <p className="whitespace-pre-wrap break-words rounded-sm border border-line p-3 text-sm text-ink">
          {candidature.lettreMotivation}
        </p>
      ) : null}

      {/* Pièce jointe : `cvSelectionne` est le booléen DÉRIVÉ du `cvPath` de la
          ligne (la clé ne quitte jamais le DTO). Le lien ouvre la route
          dédiée dans un nouvel onglet. */}
      <div>
        <h3 className="text-sm font-semibold text-ink">CV joint</h3>
        {candidature.cvSelectionne ? (
          <a
            href={`/api/files/cv?candidature=${candidature.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClassName('secondary', 'sm')} mt-1`}
          >
            Voir le CV
          </a>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">Aucun CV joint.</p>
        )}
      </div>

      {/* Transitions (ilot client) : en bas de fiche, une action par cible
          autorisée par la matrice — `[]` → rien de rendu. */}
      <TransitionsCandidature
        candidatureId={candidature.id}
        statut={candidature.statut}
      />
    </Card>
  )
}
