import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Footer } from "@/components/layout/footer";
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

        <main id="contenu" className="flex-1">
          {children}
        </main>

        <Footer />
      </body>
    </html>
  );
}
