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

  // En-têtes de sécurité appliqués à toutes les routes. Ils ne dépendent
  // d'aucun secret et ne changent pas le rendu : ils ferment le sniffing MIME,
  // le cadrage de l'application et les permissions navigateur par défaut.
  // HSTS n'est ajouté qu'en production, jamais en développement ni en test.
  // Un build de production lancé en HTTP local l'émet quand même ; les
  // navigateurs ignorent HSTS sur une origine HTTP non sécurisée.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
