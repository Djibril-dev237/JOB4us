import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Header } from "@/components/layout/header";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Job4Us : offres d'emploi et recrutement au Cameroun",
    template: "%s | Job4Us",
  },
  description:
    "Job4Us met en relation les candidats et les recruteurs au Cameroun : recherche d'offres d'emploi, candidatures, publication d'offres et suivi du recrutement.",
};

// ─── Layout racine ───────────────────────────────────────────────────────────
// html/body + Header + shells des route groups (site) et (app).
// RESTE SYNCHRONE : c'est la position éprouvée face au bug upstream
// vercel/next.js#98097 (voir le commentaire détaillé dans header.tsx).
//
// RÈGLE : la seule suspension async tolérée est le Header — enfant direct de
// ce layout, sans wrapper {children}. Le layout racine async, un wrapper
// async autour de {children}, et tout composant sous loading.tsx cassent
// l'hydratation du sous-arbre (squelette bloqué, contenu dans un div hidden
// jamais swapé, console propre) — testés en dev.
// Donc : layouts de groupes et pages restent strictement synchrones ; les
// données de session côté sidebar descendent du client via useSession.
// ---------------------------------------------------------------------------

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-screen flex-col bg-canvas text-ink">
        {/* Lien d'évitement : premier élément focalisable de la page */}
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand focus:shadow-lift"
        >
          Aller au contenu principal
        </a>

        <Header />

        {children}
      </body>
    </html>
  );
}
