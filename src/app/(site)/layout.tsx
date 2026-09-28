import { Footer } from "@/components/layout/footer";

// ─── Shell public (site) ─────────────────────────────────────────────────────
// Réf. layouts/app.blade.php : contenu + footer sous la navbar (le Header vit
// dans le layout racine — règle de suspension, voir layout.tsx). Le shell
// connecté (sidebar 264px, sans footer public) vit dans le groupe (app).
// Composants strictement synchrones (aucun await sous loading.tsx).
// Route group = clé de type « / » (le groupe n'entre pas dans l'URL).
// ---------------------------------------------------------------------------
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
