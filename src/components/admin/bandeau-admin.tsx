// ─── Bandeau partagé des écrans d'administration (M10) ───────────────────────
// Le message est toujours une chaîne déjà résolue par un catalogue ; aucune
// donnée d'URL ou de formulaire n'est affichée telle quelle. Un refus est
// annoncé (`role="alert"`), un succès ou une information via `role="status"`.
// ---------------------------------------------------------------------------

export type VarianteBandeauAdmin = 'info' | 'succes' | 'erreur'

interface BandeauAdminProps {
  variante: VarianteBandeauAdmin
  message: string
}

const CLASSES: Record<VarianteBandeauAdmin, string> = {
  info: 'bg-brand-tint text-brand-dark',
  succes: 'bg-ok-tint text-ok',
  erreur: 'bg-danger-tint text-danger',
}

export function BandeauAdmin({ variante, message }: BandeauAdminProps) {
  return (
    <p
      role={variante === 'erreur' ? 'alert' : 'status'}
      className={`rounded-md px-4 py-3 text-sm font-medium ${CLASSES[variante]}`}
    >
      {message}
    </p>
  )
}
