'use client'

import type { ReactNode } from 'react'

import { buttonClassName, type ButtonVariant } from '@/components/ui/button'

// ─── Bouton d'action d'une carte d'offre (ilot client minimal) ───────────────
// Seul comportement CLIENT du dashboard : la confirmation avant suppression.
// Motif : un server component ne peut pas porter `onSubmit`/`onClick`, et la
// confirmation du legacy (`onsubmit="return confirm('Supprimer cette offre ?')"`
// sur le formulaire) doit survivre. AUCUNE autre logique ici — le choix des
// boutons selon le statut, le statut dérivé (D12) et les libellés restent
// côté serveur dans carte-offre.tsx.
//
// Le formulaire est `action={serverAction}` (Server Action passée en prop
// depuis le serveur) : sans JavaScript, la soumission native fonctionne
// quand même — la confirmation est un confort, pas une barrière de sécurité.
// ---------------------------------------------------------------------------

interface BoutonActionOffreProps {
  /** Action de @/app/actions/offres, passée en prop depuis le serveur. */
  action: (formData: FormData) => Promise<void>
  /** Id de l'offre, transmis par un input caché (jamais dans l'URL). */
  id: number
  /** Libellé visible, exact legacy (« Publier », « Supprimer »…). */
  libelle: string
  /** Texte du `title` (infobulle), comme le bouton legacy. */
  titre: string
  variante: ButtonVariant
  /** Confirmation avant envoi — uniquement la suppression (legacy). */
  confirmation?: string
  /** Icône optionnelle rendue avant le libellé. */
  icone?: ReactNode
}

export function BoutonActionOffre({
  action,
  id,
  libelle,
  titre,
  variante,
  confirmation,
  icone,
}: BoutonActionOffreProps) {
  return (
    <form action={action} className="inline-flex">
      {/* Champ `id` : la cible vient TOUJOURS du formulaire, jamais d'une
          saisie visible (l'action re-valide ownership + statut côté serveur). */}
      <input type="hidden" name="id" value={String(id)} />
      <button
        type="submit"
        title={titre}
        onClick={(event) => {
          // preventDefault annule l'action native du clic : le formulaire
          // n'est pas soumis, donc l'action serveur n'est pas appelée.
          if (confirmation !== undefined && !window.confirm(confirmation)) {
            event.preventDefault()
          }
        }}
        className={buttonClassName(variante, 'sm')}
      >
        {icone}
        {libelle}
      </button>
    </form>
  )
}
