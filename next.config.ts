import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les uploads (CV 5 Mo, images 2 Mo — `src/lib/files.ts`) transitent par des
  // server actions : la limite par défaut de Next.js (1 Mo) rejetterait tout
  // fichier au-delà en 413 BRUT, avant la validation applicative — le parcours
  // contrôlé `?erreur=fichier-invalide` deviendrait inatteignable. 8 Mo couvre
  // le plafond applicatif (5 Mo) avec marge pour la lettre (3000 car.) et
  // l'encodage multipart ; le garde-fou reste en place au-dessus.
  // Chemin de cette version (16.3.6) : `experimental.serverActions`, pas le
  // top-level `serverActions` des versions antérieures (doc embarquée +
  // config-schema.js : clé absente du type public NextConfig).
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
