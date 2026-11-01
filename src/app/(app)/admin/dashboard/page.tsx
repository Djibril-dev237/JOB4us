import type { Metadata } from 'next'

import { requireAdmin } from '@/lib/dal'

export const metadata: Metadata = {
  title: 'Tableau de bord',
}

// ─── Coquille du tableau de bord administrateur ──────────────────────────────
// Le contenu réel (métriques issues de requêtes réelles) arrive à la vague 3.
// En attendant, la garde serveur `requireAdmin()` est déjà autoritaire : le
// proxy ne fait qu'un contrôle optimiste sur le préfixe /admin.
// ---------------------------------------------------------------------------
export default async function AdminDashboard() {
  await requireAdmin()

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Tableau de bord</h1>
      <p className="mt-2 text-base text-ink-muted">
        Utilisateurs, offres, entreprises, catégories et statistiques.
      </p>
    </div>
  )
}
