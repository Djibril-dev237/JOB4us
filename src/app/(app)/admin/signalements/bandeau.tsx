// ─── Bandeau des écrans de modération (/admin/signalements) ──────────────────
// Reprise du motif de admin/offres/bandeau.tsx (composant LOCAL, rendu pur,
// aucun îlot client) avec une troisième variante `info` : le rappel
// « consultation journalisée » n'est ni un succès ni un refus, et doit
// rester visible en haut du détail à chaque ouverture.
//
// Le composant n'affiche JAMAIS de texte venu de l'URL ou du formulaire :
// la page / le formulaire lui passent UNIQUEMENT une chaîne déjà résolue
// depuis TEXTES (fail-closed, règle anti-vibecoding M8).
//
// A11y : `role="alert"` pour un refus (annoncé sans déplacer le focus),
// `role="status"` pour l'information et le succès.
// ---------------------------------------------------------------------------

interface BandeauProps {
  variante: 'info' | 'succes' | 'erreur'
  message: string
}

const CLASSES: Record<BandeauProps['variante'], string> = {
  info: 'bg-brand-tint text-brand-dark',
  succes: 'bg-ok-tint text-ok',
  erreur: 'bg-danger-tint text-danger',
}

export function Bandeau({ variante, message }: BandeauProps) {
  return (
    <p
      role={variante === 'erreur' ? 'alert' : 'status'}
      className={`rounded-md px-4 py-3 text-sm font-medium ${CLASSES[variante]}`}
    >
      {message}
    </p>
  )
}
