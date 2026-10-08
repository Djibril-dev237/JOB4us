// ─── Bandeau de retour d'action de /admin/offres (M6, D5) ────────────────────
// Le composant n'affiche JAMAIS de texte venu de l'URL : la page lui passe
// uniquement la chaîne déjà résolue par messageMaj() /
// messageErreurTransition() de @/lib/offres-labels (fail-closed : clé
// inconnue ou absente → null → aucun bandeau, jamais de texte libre).
// Rendu serveur pur, pas d'îlot client.
//
// A11y : `role="status"` pour un succès (information, non bloquante) et
// `role="alert"` pour un refus de transition : le lecteur d'écran annonce
// le retour sans déplacer le focus.
// ---------------------------------------------------------------------------

interface BandeauProps {
  variante: 'succes' | 'erreur'
  message: string
}

const CLASSES: Record<BandeauProps['variante'], string> = {
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
