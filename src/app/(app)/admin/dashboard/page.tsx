import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tableau de bord',
}

// ─── Coquille du tableau de bord administrateur ──────────────────────────────
// Shell validé en M2 v2 (navbar + sidebar) ; le contenu réel sera construit
// dans les modules d'administration. Ici : aucune donnée affichée (zéro
// métrique inventée). Protection : proxy optimiste (prefixe /admin) — pages
// strictement synchrones en attendant un arbitrage sur le bug upstream #98097.
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Tableau de bord</h1>
      <p className="mt-2 text-base text-ink-muted">
        Utilisateurs, offres, entreprises, catégories et statistiques.
      </p>
    </div>
  )
}
