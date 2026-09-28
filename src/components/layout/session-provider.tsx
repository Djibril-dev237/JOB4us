'use client'

import { SessionProvider } from 'next-auth/react'

// ─── SessionProvider (client) ────────────────────────────────────────────────
// Fournit la session Auth.js aux composants clients du shell connecté
// (sidebar : profil + sections du rôle). Session lue CÔTÉ CLIENT sur
// /api/auth/session après le montage : aucun await dans le rendu serveur,
// donc aucune suspension sous loading.tsx (bug upstream vercel/next.js#98097).
// Le premier rendu serveur et le premier rendu client voient tous deux
// status = 'loading' → pas d'écart d'hydratation.
// Le contrôle autoritaire reste porté par le proxy (routes) et le DAL
// (actions) — ceci n'est qu'une couche d'affichage.
// ---------------------------------------------------------------------------

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
