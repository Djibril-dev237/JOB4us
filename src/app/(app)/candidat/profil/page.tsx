import type { Metadata } from 'next'

import { ProfilForm } from './profil-form'

export const metadata: Metadata = {
  title: 'Mon profil',
}

// ─── Page profil candidat (M3-ST8) ───────────────────────────────────────────
// Strictement synchrone (aucun await — bug upstream #98097) : les données du
// profil sont lues côté client via GET /api/profile (route handler « moi »
// uniquement). Protection : proxy optimiste (préfixe /candidat).
// Le lien « Mon profil » de la sidebar/menu (nav.ts) pointe déjà ici.
// ---------------------------------------------------------------------------
export default function CandidatProfilPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mon profil</h1>
        <p className="mt-2 text-base text-ink-muted">
          Identité, compétences, photo et CV. Votre CV reste privé : il
          n&apos;est visible que par vous et par les recruteurs aux offres
          desquelles vous avez postulé.
        </p>
      </div>
      <ProfilForm />
    </div>
  )
}
