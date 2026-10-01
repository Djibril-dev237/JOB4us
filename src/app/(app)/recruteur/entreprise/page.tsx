import type { Metadata } from 'next'

import { EntrepriseForm } from './entreprise-form'

export const metadata: Metadata = {
  title: 'Mon entreprise',
}

// ─── Page profil entreprise (M3-ST9) ─────────────────────────────────────────
// Strictement synchrone (aucun await — bug upstream #98097) : les données
// viennent de GET /api/entreprise (route handler « moi », rôle recruteur).
// Le lien « Mon entreprise » existe déjà dans nav.ts (menu profil + sidebar).
// Contrairement au legacy (GET show() = INSERT d'une ligne manquante), AUCUNE
// écriture n'a lieu sur un GET : la ligne absente est créée au premier
// enregistrement (upsert de l'action).
// ---------------------------------------------------------------------------
export default function RecruteurEntreprisePage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mon entreprise</h1>
        <p className="mt-2 text-base text-ink-muted">
          Nom, secteur, présentation et coordonnées de votre entreprise.
        </p>
      </div>
      <EntrepriseForm />
    </div>
  )
}
