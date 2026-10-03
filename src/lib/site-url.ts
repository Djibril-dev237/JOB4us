// ─── URL de base publique (M5, task 6) ───────────────────────────────────────
//
// Source unique : NEXT_PUBLIC_APP_URL, variable EXISTANTE depuis M1
// (lien de réinitialisation de mot de passe), chargée côté serveur et
// inlinée côté client. En dev elle vaut http://localhost:3000 ; en
// production, le déploiement y configure le domaine réel — AUCUN domaine
// n'est inventé dans le code (legacy APP_URL = http://localhost, aucun
// domaine de prod documenté nulle part dans le dépôt).
//
// Sert à : metadataBase du layout racine (canonical relatifs des pages)
// et aux URLs absolues du sitemap (protocole sitemap IMPOSE des <loc>
// absolus). La barre oblique terminale est retirée pour éviter tout
// double slash dans `${SITE_URL}/offres`.
// ---------------------------------------------------------------------------

export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '')
