import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { LIBELLES_STATUT } from '@/lib/candidatures-labels'
import type { LigneListe } from '@/lib/messagerie-dal'
import { TEXTES, varianteStatutConversation } from '@/lib/messagerie-labels'

// ─── Une conversation de la liste (ligne cliquable) ──────────────────────────
// Composant SERVEUR : tout arrive dans la prop, aucun état. Le lien mène à
// /messages/<id> ; `active` (conversation ouverte en vue desktop) pilote le
// surlignage ET `aria-current="page"`.
//
// Statut : VARIANTE portée par `varianteStatutConversation` (bloc labels M8 :
// ouverte=brand, acceptee=ok, refusee=danger, retiree=neutral) et LIBELLÉ
// repris de `LIBELLES_STATUT` (src/lib/candidatures-labels.ts) — exactement le
// motif de src/lib/offres-labels.ts (table de libellés + table de variants),
// sans capitalisation inventée et sans recopier la table M7 ici.
//
// Aucun texte local : extrait vide = TEXTES.aucunMessage, pastille de non-lus =
// aria-label TEXTES.nouveauxMessages. L'extrait et le titre d'offre sont des
// DONNÉES du DAL (l'extrait complet est tronqué visuellement ici, jamais en
// base), `titreOffre` n'est affiché que si l'anti-fuite du DAL l'a rendu
// non nul (offre publiée et non supprimée).
// ---------------------------------------------------------------------------

/**
 * Horodatage court « JJ/MM/AAAA HH:MM », fuseau de la cible — motif de date
 * M6/M7 repris (formateur LOCAL : aucune implémentation d'affichage absolu
 * n'est partagée, `src/lib/dates.ts` ne produit que des dates relatives).
 * Fuseau Africa/Douala comme partout ailleurs : afficher dans le fuseau du
 * serveur décalerait d'un jour aux bornes de minuit.
 */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

interface Props {
  conversation: LigneListe
  /** Conversation ouverte en ce moment (surlignage + aria-current). */
  active: boolean
}

/** Ligne active : marque de la page, lisible sur fond surface. */
const CLASSE_ACTIVE = 'bg-brand-tint'

const CLASSE_SURVOL = 'transition-colors duration-fast hover:bg-surface-alt'

export function CarteConversation({ conversation, active }: Props) {
  const {
    conversationId,
    nomInterlocuteur,
    titreOffre,
    statutCandidature,
    dernierMessage,
    nonLus,
  } = conversation

  // Pas encore de message : état vide partagé (« conversation » et « carte »
  // racontent la même absence), jamais une chaîne locale ni un doublon.
  const extrait = dernierMessage === null ? TEXTES.conversationVide : dernierMessage.contenu

  return (
    <Link
      href={`/messages/${conversationId}`}
      aria-current={active ? 'page' : undefined}
      className={`flex min-w-0 items-start gap-3 px-4 py-3 ${CLASSE_SURVOL} ${
        active ? CLASSE_ACTIVE : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-bold text-ink">{nomInterlocuteur}</span>
          <Badge variant={varianteStatutConversation(statutCandidature)}>
            {LIBELLES_STATUT[statutCandidature]}
          </Badge>
        </div>

        {titreOffre !== null ? (
          <p className="truncate text-xs font-semibold text-ink-muted">{titreOffre}</p>
        ) : null}

        <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm text-ink-muted">{extrait}</p>
          {dernierMessage !== null ? (
            <time
              dateTime={dernierMessage.createdAt.toISOString()}
              className="shrink-0 text-xs text-ink-muted"
            >
              {FORMATEUR_DATE.format(dernierMessage.createdAt)}
            </time>
          ) : null}
        </div>
      </div>

      {/* Pastille de non-lus : compteur visible, libellé TEXTES en aria-label. */}
      {nonLus > 0 ? (
        <span
          aria-label={TEXTES.nouveauxMessages}
          className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white"
        >
          {nonLus}
        </span>
      ) : null}
    </Link>
  )
}
