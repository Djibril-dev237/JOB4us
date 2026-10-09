// ─── Redirection interne après connexion (anti open-redirect) ────────────────
//
// Contexte (M7) : la fiche publique d'une offre et la page « Postuler »
// envoient un visiteur vers `/login?redirect=<chemin>` ; après connexion,
// l'action `login` doit le ramener sur sa page d'origine. Sans validation,
// `/login?redirect=https://evil.com` ferait de NOTRE page de connexion un
// vecteur de phishing de même origine (open redirect).
//
// Règles (échec → null, l'appelant retombe sur la cible par défaut `/`) :
// - non vide et ≤ REDIRECTION_LONGUEUR_MAX caractères ;
// - commence par `/` : seul un chemin relatif peut être de même origine ;
// - jamais un second `/` initial : `//host` est une URL protocole-relatif,
//   valable pour TOUTE origine (donc externe) ;
// - aucun caractère de contrôle (< U+0020 : CR/LF/NUL…, injection
//   d'en-tête) ni antislash (U+005C) : certains navigateurs réécrivent
//   « /\evil.com » en « //evil.com ».
//
// Le reste — `javascript:`, `https:`, `%0d%a0` littéral, fragments, query —
// soit est rejeté par les règles ci-dessus, soit reste un chemin de même
// origine. La validation est faite UNIQUEMENT côté serveur (source de
// vérité : l'action `login`) ; le formulaire ne fait que transmettre la
// valeur brute du paramètre d'URL.
// ---------------------------------------------------------------------------

/** Longueur maximale acceptée d'une cible de redirection interne. */
export const REDIRECTION_LONGUEUR_MAX = 1024

/**
 * Valide une cible de redirection de même origine.
 *
 * @param raw valeur brute (paramètre d'URL `?redirect=` ou champ caché de
 *   formulaire — chaîne vide si le champ est absent ou non textuel)
 * @returns le chemin validé, ou `null` si la cible est absente, vide, trop
 *   longue, externe ou malformée (appelant : `?? '/'`)
 */
export function redirectionInterne(raw: string): string | null {
  if (raw.length === 0 || raw.length > REDIRECTION_LONGUEUR_MAX) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null

  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    // Contrôle (< U+0020), DEL (U+007F) ou antislash (U+005C) : rejeté
    // par code explicite (aucune regex à caractères de contrôle, lint
    // no-control-regex).
    if (code < 0x20 || code === 0x7f || code === 0x5c) return null
  }

  return raw
}
