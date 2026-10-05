// ─── Frontière de date sur le fuseau cible (Africa/Douala, UTC+1) ─────────────
// Extrait de src/lib/offres-public.ts (M6, préalable P2) pour être
// partageable : ce module est INTENTIONNELLEMENT sans `server-only`, car
// les libellés de statut (src/lib/offres-labels.ts) dérivent « expirée »
// à l'affichage et transitent vers des composants clients, alors que
// offres-public.ts ne quitte jamais le serveur.
//
// Règle inchangée (M5, étape 2 validée) : le jour d'expiration est INCLUS
// à Douala — l'offre reste visible toute la journée de son expiration, et
// « expirée » commence au minuit civil suivant (calculé sur Africa/Douala,
// jamais sur le fuseau du serveur applicatif : dev UTC+1 et Vercel UTC
// doivent donner la même réponse). Une seule implémentation frontière,
// deux usages : le prédicat SQL (offreVisible) et l'affichage (statutAffiche).
// ---------------------------------------------------------------------------

/** Fuseau de la cible (Cameroun) : toute date publique s'y réfère. */
const FUSEAU_OFFRES = 'Africa/Douala'

const FORMATEUR_JOUR = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU_OFFRES,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Date du jour au Cameroun, en clair ('YYYY-MM-DD').
 * Sert de base à la frontière d'expiration : le jour est calculé sur le
 * fuseau de la cible, jamais sur celui du serveur applicatif.
 */
export function dateCouranteDouala(now: Date = new Date()): string {
  return FORMATEUR_JOUR.format(now)
}

/**
 * Minuit civil à Douala exprimé comme instant UTC (le Cameroun est en
 * UTC+1 sans DST : décalage constant). Utilisé tel quel dans le filtre
 * `dateExpiration.gte` du prédicat public — forme acceptée par Prisma
 * (contrairement à la date en clair) et vérifié comme « jour inclus »
 * contre MySQL en M5.
 */
export function minuitDouala(civil: string): Date {
  const [annee, mois, jour] = civil.split('-').map(Number)
  return new Date(Date.UTC(annee, mois - 1, jour) - 3_600_000)
}

/**
 * L'offre est-elle expirée pour `now` ? Frontière INCLUSIVE : le jour de
 * `dateExpiration` reste entier à Douala, l'expiration commence au minuit
 * civil suivant (23:00Z de la veille).
 *
 * Comparaison strictement équivalente au filtre `dateExpiration.gte` du
 * prédicat unique (offreVisible) : même frontière, deux usages — SQL pour
 * la visibilité, ce prédicat pour l'affichage (badge « Expirée »,
 * filtre du dashboard). Aucune écriture ni cron : recalculé à chaque
 * lecture.
 */
export function estExpiree(dateExpiration: Date, now: Date = new Date()): boolean {
  return dateExpiration.getTime() < minuitDouala(dateCouranteDouala(now)).getTime()
}
