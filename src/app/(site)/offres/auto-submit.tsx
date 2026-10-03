'use client'

import type { ReactNode } from 'react'

// ─── Soumission auto du formulaire au changement d'un select ─────────────────
// Parité legacy : les 3 selects de filtres avaient
// `onchange="this.form.submit()"` (offres/index.blade.php). React interdit
// les handlers en chaîne de caractères : on regarde la soumission via un
// événement React classique, sans état ni rendu côté client.
//
// `display:contents` (ref. `d-contents` legacy) : le wrapper ne casse pas la
// mise en page de la rangée de filtres. C'est le seul îlot client de la page
// — les selects restent rendus et opérationnels côté serveur (le bouton
// « Rechercher » soumet tout sans JavaScript, la règle de non-régression
// M2-M4 reste donc intacte côté no-JS).
// ---------------------------------------------------------------------------

export function AutoSubmitOnChange({ children }: { children: ReactNode }) {
  return (
    <div
      className="contents"
      onChange={(event) => {
        // currentTarget = ce wrapper (aucun cast) : on remonte au formulaire
        // unique et on le soumet avec l'état courant des champs.
        event.currentTarget.closest('form')?.requestSubmit()
      }}
    >
      {children}
    </div>
  )
}
