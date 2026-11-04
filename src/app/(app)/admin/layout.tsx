import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// ─── Métadonnées de l'espace admin (M10) ────────────────────────────────────
// Les pages admin ne doivent jamais être indexées, même si une configuration
// de proxy ou un futur changement de routage laissait passer une réponse 200.
// Les invités et non-admins restent protégés par le 404 strict du proxy et de
// `requireAdmin()` ; ceci est une défense supplémentaire côté robots.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children
}
