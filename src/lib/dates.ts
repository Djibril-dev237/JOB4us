// ─── Date relative en français (affichage public des offres) ─────────────────
// Parité legacy : les cartes d'offres affichent `created_at->diffForHumans()`
// (Carbon). Carbon est ABSENT de legacy_laravel/vendor (constat) : ses
// seuils exacts d'unités sont donc invérifiables et ne sont pas supposés —
// seuils standards assumés et documentés : 60 s / 60 min / 24 h / 30 j /
// 365 j, avec arrondi à l'unité inférieure (jamais « 1,5 jour »).
// Les libellés sont produits par Intl.RelativeTimeFormat('fr') en mode
// numeric:'always' pour retrouver la famille « il y a N … » (jamais
// « hier », que le mode 'auto' afficherait).
// ---------------------------------------------------------------------------

const SECONDE = 1000
const MINUTE = 60 * SECONDE
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE
const JOURS_PAR_MOIS = 30
const JOURS_PAR_AN = 365

const FORMAT_RELATIF = new Intl.RelativeTimeFormat('fr', { numeric: 'always' })

/**
 * Date relative FR : « il y a 3 jours », « il y a 2 heures », « il y a
 * 1 mois ». Une date postérieure au moment courant rend « dans N … »
 * (cas nominal : created_at toujours passé). Date invalide → chaîne vide
 * plutôt qu'une exception Intl.
 */
export function dateRelativeFr(date: Date, maintenant: Date = new Date()): string {
  const ecartMs = maintenant.getTime() - date.getTime()
  if (!Number.isFinite(ecartMs)) return ''

  // Passé → valeur négative (« il y a »), futur → positive (« dans »).
  const sens = ecartMs < 0 ? 1 : -1
  const ms = Math.abs(ecartMs)

  if (ms < MINUTE) {
    // Sous la minute : au moins 1 seconde (jamais « il y a 0 seconde »).
    return FORMAT_RELATIF.format(sens * Math.max(1, Math.round(ms / SECONDE)), 'second')
  }
  if (ms < HEURE) return FORMAT_RELATIF.format(sens * Math.floor(ms / MINUTE), 'minute')
  if (ms < JOUR) return FORMAT_RELATIF.format(sens * Math.floor(ms / HEURE), 'hour')

  const jours = Math.floor(ms / JOUR)
  if (jours < JOURS_PAR_MOIS) return FORMAT_RELATIF.format(sens * jours, 'day')
  if (jours < JOURS_PAR_AN) {
    return FORMAT_RELATIF.format(sens * Math.floor(jours / JOURS_PAR_MOIS), 'month')
  }
  return FORMAT_RELATIF.format(sens * Math.floor(jours / JOURS_PAR_AN), 'year')
}
