// ─── Bandeau « lecture seule » / « écriture bloquée » au-dessus du fil ───────
// Composant SERVEUR, présentation SEULEMENT : aucun texte n'est écrit ici —
// `texte` est fourni par la page appelante, exclusivement via
// `texteMotifLectureSeule(motif)` (3 statuts terminaux de la candidature) ou
// `TEXTES.ecritureBloquee` (blocage d'interlocuteur), jamais un libellé local.
// `role="note"` : information en marge du flux (ce n'est ni un statut à lire
// automatiquement ni une alerte d'erreur de formulaire).
//
// 2 variantes = 2 teintes M2 : neutral (conclusion de candidature, simple
// information) et danger (écriture bloquée par un blocage).
// ---------------------------------------------------------------------------

interface Props {
  texte: string
  variante: 'neutral' | 'danger'
}

/** Bandeau neutre (tokens M2, motif ALERTE de M6). */
const CLASSE_NEUTRE =
  'rounded-sm border border-line bg-surface-alt px-3 py-2 text-sm text-ink-muted'

/** Bandeau bloqué (tokens M2, motif ALERTE_ERREUR de M6). */
const CLASSE_DANGER =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

export function BandeauConversation({ texte, variante }: Props) {
  return (
    <p role="note" className={variante === 'danger' ? CLASSE_DANGER : CLASSE_NEUTRE}>
      {texte}
    </p>
  )
}
