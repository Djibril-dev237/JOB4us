import { AppSessionProvider } from '@/components/layout/session-provider'
import { Sidebar } from '@/components/layout/sidebar'

// ─── Shell connecté (app) ────────────────────────────────────────────────────
// Réf. dash.blade.php + sidebars legacy : navbar 64px (layout racine) puis
// sidebar fixe 264px à gauche et contenu à droite. Pas de footer public sur
// les espaces connectés.
// Strictement synchrone (aucun await sous loading.tsx — bug upstream #98097) :
// la session de la sidebar est lue côté client via AppSessionProvider.
// Route group = clé de type « / » (le groupe n'entre pas dans l'URL).
// ---------------------------------------------------------------------------

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppSessionProvider>
      <div className="flex min-h-[calc(100vh-4rem)]">
        <Sidebar />
        <main id="contenu" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </AppSessionProvider>
  )
}
