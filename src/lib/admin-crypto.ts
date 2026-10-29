// ─── Cryptographie de l'authentification admin (M10) ────────────────────────
//
// Module PUR, sans import d'application : utilisé par les Server Actions, par
// Auth.js et par la CLI d'administration. Aucune clé n'est lue au chargement :
// une variable absente échoue au moment de l'usage, jamais au build.
//
//  * jetons de challenge / invitation : 32 octets aléatoires, stockés HACHÉS
//    (SHA-256) ; le secret en clair ne quitte le serveur qu'une fois ;
//  * TOTP : RFC 6238, SHA-1, 6 chiffres, pas de 30 secondes, fenêtre ±1,
//    anti-rejeu par `totpLastStep` ;
//  * secret TOTP chiffré en AES-256-GCM avec ADMIN_2FA_KEY (base64, 32 octets) ;
//  * codes de récupération : 10 codes à usage unique, stockés HACHÉS ;
//  * grants de consultation et de réauthentification : HMAC-SHA256 signé avec
//    AUTH_SECRET, expiration courte côté serveur (cookie httpOnly).
// ---------------------------------------------------------------------------

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60
export const ADMIN_CHALLENGE_TTL_MS = 5 * 60 * 1000
export const ADMIN_REAUTH_TTL_MS = 5 * 60 * 1000
export const ADMIN_ACCES_SIGNALEMENT_TTL_MS = 5 * 60 * 1000
export const ADMIN_MAX_TENTATIVES_OTP = 5
export const ADMIN_FENETRE_OTP_MS = 5 * 60 * 1000

export const COOKIE_CHALLENGE_ADMIN = 'job4us.admin.challenge'
export const COOKIE_REAUTH_ADMIN = 'job4us.admin.reauth'
export const COOKIE_ACCES_SIGNALEMENT_PREFIX = 'job4us.admin.signalement.'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_PERIODE_SECONDES = 30
const TOTP_CHIFFRES = 6
const AAD_TOTP = Buffer.from('job4us:m10:totp:v1', 'utf8')

// ─── Jetons opaques ──────────────────────────────────────────────────────────

/** Jeton aléatoire URL-safe (43 caractères pour 32 octets). */
export function genererJeton(): string {
  return randomBytes(32).toString('base64url')
}

/** Empreinte SHA-256 hexadécimale d'un jeton ou d'un code de récupération. */
export function hacherJeton(jeton: string): string {
  return createHash('sha256').update(jeton, 'utf8').digest('hex')
}

/** Comparaison constante de deux chaînes de longueur quelconque. */
function egalConstant(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// ─── Base32 et TOTP ──────────────────────────────────────────────────────────

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let valeur = 0
  let sortie = ''
  for (const octet of buffer) {
    valeur = ((valeur << 8) | octet) & 0xffff
    bits += 8
    while (bits >= 5) {
      sortie += BASE32_ALPHABET[(valeur >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    sortie += BASE32_ALPHABET[(valeur << (5 - bits)) & 31]
  }
  return sortie
}

export function base32Decode(secret: string): Buffer {
  const propre = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  if (propre.length === 0) throw new Error('Secret TOTP vide.')
  let bits = 0
  let valeur = 0
  const octets: number[] = []
  for (const caractere of propre) {
    const index = BASE32_ALPHABET.indexOf(caractere)
    if (index < 0) throw new Error('Secret TOTP invalide.')
    valeur = ((valeur << 5) | index) & 0xffff
    bits += 5
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(octets)
}

/** Secret TOTP de 20 octets (160 bits), format base32 standard. */
export function genererSecretTotp(): string {
  return base32Encode(randomBytes(20))
}

/** Numéro de pas TOTP (30 secondes) d'un instant donné. */
export function pasTotp(maintenant: number = Date.now()): number {
  return Math.floor(maintenant / 1000 / TOTP_PERIODE_SECONDES)
}

/**
 * Code TOTP RFC 6238 à 6 chiffres pour un pas donné. Exporté pour les tests
 * (vecteurs RFC) et pour l'activation qui doit vérifier un secret pas encore
 * stocké. Le secret est décodé en base32.
 */
export function genererCodeTotp(secret: string, pas: number = pasTotp()): string {
  const cle = base32Decode(secret)
  const compteur = Buffer.alloc(8)
  compteur.writeBigUInt64BE(BigInt(pas))
  const hmac = createHmac('sha1', cle).update(compteur).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binaire =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binaire % 10 ** TOTP_CHIFFRES).padStart(TOTP_CHIFFRES, '0')
}

export interface ResultatVerificationTotp {
  valide: boolean
  /** Pas réellement validé, à stocker dans `totpLastStep` (anti-rejeu). */
  pas?: number
}

/**
 * Vérifie un code TOTP à ±1 pas. Un pas déjà consommé (`lastStep`) est refusé :
 * le rejeu d'un code encore dans la fenêtre ne crée pas de seconde session.
 */
export function verifierCodeTotp(
  secret: string,
  code: string,
  lastStep: number | null | undefined,
  maintenant: number = Date.now(),
): ResultatVerificationTotp {
  const propre = code.replace(/\s/g, '')
  if (!new RegExp(`^[0-9]{${TOTP_CHIFFRES}}$`).test(propre)) return { valide: false }

  const courant = pasTotp(maintenant)
  const minimum = lastStep ?? -1
  for (const pas of [courant - 1, courant, courant + 1]) {
    if (pas <= minimum) continue
    if (egalConstant(genererCodeTotp(secret, pas), propre)) {
      return { valide: true, pas }
    }
  }
  return { valide: false }
}

export function estCodeTotp(code: string): boolean {
  return new RegExp(`^[0-9]{${TOTP_CHIFFRES}}$`).test(code.replace(/\s/g, ''))
}

// ─── Chiffrement du secret TOTP ──────────────────────────────────────────────

function cleAdmin2fa(): Buffer {
  const brut = process.env.ADMIN_2FA_KEY
  if (!brut) {
    throw new Error('ADMIN_2FA_KEY manquante : impossible de chiffrer le secret TOTP.')
  }
  const cle = Buffer.from(brut, 'base64')
  if (cle.length !== 32) {
    throw new Error('ADMIN_2FA_KEY doit contenir 32 octets encodés en base64.')
  }
  return cle
}

export function chiffrerSecretTotp(secret: string, key?: Buffer): string {
  const cle = key ?? cleAdmin2fa()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cle, iv)
  cipher.setAAD(AAD_TOTP)
  const chiffre = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    chiffre.toString('base64url'),
  ].join(':')
}

export function dechiffrerSecretTotp(texte: string, key?: Buffer): string {
  const parties = texte.split(':')
  if (parties.length !== 4 || parties[0] !== 'v1') {
    throw new Error('Secret TOTP chiffré invalide.')
  }
  const [, ivPart, tagPart, donneesPart] = parties
  if (!ivPart || !tagPart || !donneesPart) {
    throw new Error('Secret TOTP chiffré invalide.')
  }
  const cle = key ?? cleAdmin2fa()
  const decipher = createDecipheriv('aes-256-gcm', cle, Buffer.from(ivPart, 'base64url'))
  decipher.setAAD(AAD_TOTP)
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(donneesPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

// ─── Codes de récupération ───────────────────────────────────────────────────

export function normaliserCodeRecuperation(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hacherCodeRecuperation(code: string): string {
  return hacherJeton(normaliserCodeRecuperation(code))
}

export interface CodesRecuperation {
  /** Codes en clair, à afficher UNE seule fois. */
  codes: string[]
  /** Empreintes à stocker en base. */
  hashes: string[]
}

/** Dix codes à usage unique de 10 caractères base32, format XXXXX-XXXXX. */
export function genererCodesRecuperation(): CodesRecuperation {
  const codes = new Set<string>()
  while (codes.size < 10) {
    const octets = randomBytes(10)
    const caracteres = Array.from(octets, (octet) => BASE32_ALPHABET[octet % 32])
    codes.add(`${caracteres.slice(0, 5).join('')}-${caracteres.slice(5).join('')}`)
  }
  const liste = [...codes]
  return {
    codes: liste,
    hashes: liste.map(hacherCodeRecuperation),
  }
}

// ─── Jetons signés (grant de consultation, réauthentification) ──────────────

interface ChargeSignee {
  v: 1
  e: number
  [cle: string]: unknown
}

function secretAuth(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET manquante : impossible de signer le jeton.')
  return secret
}

function signerCharge(charge: ChargeSignee): string {
  const corps = Buffer.from(JSON.stringify(charge), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secretAuth()).update(corps).digest('base64url')
  return `${corps}.${signature}`
}

function verifierCharge(jeton: string): ChargeSignee | null {
  const parties = jeton.split('.')
  if (parties.length !== 2) return null
  const [corps, signature] = parties
  if (!corps || !signature) return null
  const attendue = createHmac('sha256', secretAuth()).update(corps).digest('base64url')
  if (!egalConstant(signature, attendue)) return null
  try {
    const charge = JSON.parse(
      Buffer.from(corps, 'base64url').toString('utf8'),
    ) as Partial<ChargeSignee>
    if (charge.v !== 1 || typeof charge.e !== 'number') return null
    return charge as ChargeSignee
  } catch {
    return null
  }
}

export function nomCookieAccesSignalement(signalementId: number): string {
  return `${COOKIE_ACCES_SIGNALEMENT_PREFIX}${signalementId}`
}

/**
 * Grant de consultation privée d'UN signalement, lié à l'admin et au
 * signalement. Expiration 5 minutes, vérifiée côté serveur, jamais prolongée
 * par le client.
 */
export function creerJetonAccesSignalement(
  adminId: number,
  signalementId: number,
  maintenant: number = Date.now(),
): string {
  return signerCharge({
    v: 1,
    e: maintenant + ADMIN_ACCES_SIGNALEMENT_TTL_MS,
    a: adminId,
    s: signalementId,
  })
}

export function verifierJetonAccesSignalement(
  jeton: string | null | undefined,
  adminId: number,
  signalementId: number,
  maintenant: number = Date.now(),
): boolean {
  if (!jeton) return false
  const charge = verifierCharge(jeton)
  return (
    charge !== null &&
    charge.a === adminId &&
    charge.s === signalementId &&
    charge.e > maintenant
  )
}

/** Fenêtre de réauthentification de 5 minutes pour les actions sensibles. */
export function creerJetonReauth(
  adminId: number,
  maintenant: number = Date.now(),
): string {
  return signerCharge({
    v: 1,
    t: 'reauth',
    e: maintenant + ADMIN_REAUTH_TTL_MS,
    a: adminId,
  })
}

export function verifierJetonReauth(
  jeton: string | null | undefined,
  adminId: number,
  maintenant: number = Date.now(),
): boolean {
  if (!jeton) return false
  const charge = verifierCharge(jeton)
  return charge !== null && charge.t === 'reauth' && charge.a === adminId && charge.e > maintenant
}
