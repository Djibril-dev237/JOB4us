import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import type { LiensEmail } from '@/lib/notifications-emails'
import { SITE_URL } from '@/lib/site-url'

// ─── Liens des emails et jeton de désabonnement (M9, Vague 3) ────────────────
//
// DEUX responsabilités, un seul module :
//
// 1. VALIDATION DES LIENS INTERNES. Les branches émettrices M7/M8 construisent
//    des chemins relatifs (`/messages/12`, `/offres/slug`…), mais la base ne
//    doit JAMAIS servir de relais vers un schéma exécutable : un `lien` stocké
//    est rendu en `<Link>` par l'UI (l'échappement HTML ne protège pas un
//    href) et repris tel quel dans les emails. `estLienInterne` n'accepte
//    qu'un chemin ABSOLU du site :
//      * commence par UN seul `/` — rejette `javascript:`, `data:`, `mailto:`
//        et toute URL absolue (http:, https:) ;
//      * refuse `//` (URL protocol-relative : `//evil.example` sortirait du
//        site) ;
//      * refuse `\` (`/\evil.example` est interprété comme `//` par les
//        navigateurs) ;
//      * refuse espaces et caractères de contrôle (`\n`, `\t`, NUL) qui
//        permettent de déguiser un schéma (`/ \t javascript:`).
//    Défense en profondeur : l'émission réécrit en `null` tout lien refusé
//    (notifications-emission.ts), l'UI ne rend déjà un lien que s'il commence
//    par `/`.
//
// 2. JETON DE DÉSABONNEMENT 1-CLIC, SANS ÉTAT, HMAC-SHA256 :
//      payload = `v1.<userId>.<expiration epoch ms>` — signature base64url.
//    * La clé est `AUTH_SECRET` (variable existante, aucun secret inventé) :
//      une rotation invalide les liens encore en circulation, comportement
//      attendu et documenté par `TEXTES.jetonInvalide` ;
//    * durée de vie 7 jours, valeur EXACTE de `TEXTES.explicationJeton` —
//      une seule source, jamais 7 ici et 30 ailleurs ;
//    * comparaison en TEMPS CONSTANT (`timingSafeEqual`) : une signature
//      forgée ne s'approche pas octet par octet ;
//    * le jeton ne porte AUCUNE donnée personnelle (un entier et une date) et
//      ne donne accès qu'au réglage `emailsActives` de SON porteur.
//
// L'absence de secret rend `creerJetonDesabonnement`/`liensEmail` nuls : les
// emails sont alors SAUTÉS (un email sans lien de désabonnement fonctionnel
// serait non conforme). Aucune exception : les appels vivent dans des crons
// et des hooks qui ne doivent jamais jeter.
// ---------------------------------------------------------------------------

/** 7 jours, valeur verrouillée par `TEXTES.explicationJeton`. */
export const DUREE_JETON_MS = 7 * 24 * 60 * 60 * 1000

const PREFIXE_JETON = 'v1'
const LONGUEUR_MAX_JETON = 512
const UTILISATEUR_STRICT = /^[1-9]\d{0,14}$/
const EXPIRATION_STRICTE = /^[1-9]\d{0,14}$/

/**
 * Vrai si `lien` est un chemin interne sûr (voir le contrat en tête de
 * module). Fonction PURE : ni base, ni environnement, testable seule.
 */
export function estLienInterne(lien: string): boolean {
  if (!lien.startsWith('/')) return false
  if (lien.startsWith('//')) return false
  if (lien.includes('\\')) return false
  // `\s` couvre espaces, tabulations et sauts de ligne ; les plages explicites
  // couvrent les contrôles ASCII (NUL, DEL) et C1 que `\s` ignore.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(lien)) return false
  return true
}

/** Secret courant, ou `null` si l'environnement ne le fournit pas. */
function lireSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim()
  return secret ? secret : null
}

/** HMAC-SHA256 base64url du payload (ASCII), avec la clé fournie. */
function signer(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')
}

/**
 * Crée un jeton personnel expirant à `maintenant + 7 jours`. Rend `null` si
 * le secret est absent ou si l'identifiant n'est pas un entier positif : dans
 * les deux cas, l'appelant SAUTE l'email (jamais d'exception).
 */
export function creerJetonDesabonnement(
  userId: number,
  maintenant: Date = new Date(),
): string | null {
  const secret = lireSecret()
  if (secret === null) return null
  if (!Number.isSafeInteger(userId) || userId <= 0) return null

  const payload = `${PREFIXE_JETON}.${userId}.${maintenant.getTime() + DUREE_JETON_MS}`
  return `${payload}.${signer(payload, secret)}`
}

/**
 * Vérifie forme, signature (temps constant) et expiration. Rend
 * `{ userId }` si le jeton est authentique et encore valide, `null` sinon —
 * un seul verdict, aucune distinction exposée à l'appelant entre « forgé »,
 * « expiré » et « mal formé » : la page affiche le même `jetonInvalide`.
 */
export function verifierJetonDesabonnement(
  jeton: string,
  maintenant: Date = new Date(),
): { userId: number } | null {
  const secret = lireSecret()
  if (secret === null) return null
  if (jeton.length === 0 || jeton.length > LONGUEUR_MAX_JETON) return null

  const morceaux = jeton.split('.')
  if (morceaux.length !== 4) return null

  const [prefixe, userIdBrut, expirationBrute, signature] = morceaux
  if (prefixe !== PREFIXE_JETON) return null
  if (!UTILISATEUR_STRICT.test(userIdBrut)) return null
  if (!EXPIRATION_STRICTE.test(expirationBrute)) return null

  const userId = Number.parseInt(userIdBrut, 10)
  const expiration = Number.parseInt(expirationBrute, 10)
  if (!Number.isSafeInteger(userId) || userId <= 0) return null

  const attendue = Buffer.from(
    signer(`${PREFIXE_JETON}.${userIdBrut}.${expirationBrute}`, secret),
    'utf8',
  )
  const recue = Buffer.from(signature, 'utf8')
  if (recue.length !== attendue.length) return null
  if (!timingSafeEqual(recue, attendue)) return null

  // Expiration STRICTE : un jeton expiré à l'instant est refusé.
  if (expiration <= maintenant.getTime()) return null

  return { userId }
}

/**
 * URLs absolues du pied de page des emails : préférences + désabonnement
 * personnel. `null` quand le jeton ne peut pas être signé (secret absent) —
 * l'appelant saute l'email. Fonction PURE vis-à-vis de la base.
 */
export function liensEmail(
  destinataireId: number,
  maintenant: Date = new Date(),
): LiensEmail | null {
  const jeton = creerJetonDesabonnement(destinataireId, maintenant)
  if (jeton === null) return null

  return {
    preferences: `${SITE_URL}/notifications/preferences`,
    desabonnement: `${SITE_URL}/desabonnement/${jeton}`,
  }
}
