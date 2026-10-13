import 'server-only'

/**
 * Rate limiting en mémoire, fenêtre glissante par processus.
 *
 * Portée : monoprocessus (dev, instance unique). Si l'application est
 * déployée sur plusieurs instances/serviteurs, ce store doit être remplacé
 * par un store partagé (Redis, Upstash) — hors périmètre de M1.
 */

interface Bucket {
  /** Dates (ms) des tentatives encore dans la fenêtre + dernière activité. */
  attempts: number[]
  last: number
}

const buckets = new Map<string, Bucket>()

/** Nombre maximal de clés avant purge (protection mémoire). */
const MAX_BUCKETS = 10_000

/** Fenêtre maximale utilisée par ce module (D6 : 1 h) : borne de `sweep()`,
 * qui ne purge que les clés plus vieilles qu'elle. Exposée pour le test
 * d'invariant ci-dessous : elle doit TOUJOURS couvrir la plus longue
 * fenêtre appelée (`OFFRES_CREATION_WINDOW_MS`), sinon un seau D6 encore
 * actif serait purgé dès que la Map déborde de `MAX_BUCKETS` — plafond
 * 10/h devenu fail-open sans qu'aucun échec de grille ne l'indique. */
export const MAX_WINDOW_MS = 60 * 60 * 1_000

// ─── Politique de connexion (M1) ─────────────────────────────────────────────

/** Tentatives max par identifiant (email/téléphone) par fenêtre. */
export const LOGIN_MAX_ATTEMPTS_PER_IDENTIFIER = 5

/** Tentatives max par adresse IP par fenêtre. */
export const LOGIN_MAX_ATTEMPTS_PER_IP = 30

/** Fenêtre glissante de comptage. */
export const LOGIN_WINDOW_MS = 5 * 60 * 1_000

// ─── Politique de lecture publique (M5) ──────────────────────────────────────
//
// Périmètre : /offres, /offres/<slug>, /sitemap.xml, /api/files/logo —
// appliqué par src/proxy.ts (Next 16 : middleware.ts → proxy.ts).
// 120 req/min/IP = 2 req/s soutenues : très au-dessus de tout usage humain
// (navigation + prefetch), très en deçà d'un automate de scraping.

/** Requêtes max par adresse IP sur le périmètre public M5 par fenêtre. */
export const OFFRES_MAX_REQUESTS_PER_IP = 120

/** Fenêtre glissante des requêtes publiques M5. */
export const OFFRES_WINDOW_MS = 60 * 1_000

// ─── Politique de création d'offres (M6, D6) ─────────────────────────────────
//
// 10 créations d'offres par heure et par compte recruteur : le même seau
// pour `creerOffre` et `dupliquerOffre` (clé `offres:creation:<userId>`) —
// une duplication crée une ligne au même titre qu'un formulaire, le
// budget ne se contourne pas par le bouton Dupliquer.

/** Créations d'offres max par compte recruteur par fenêtre. */
export const OFFRES_CREATION_MAX_PAR_COMPTE = 10

/** Fenêtre glissante des créations d'offres M6. */
export const OFFRES_CREATION_WINDOW_MS = 60 * 60 * 1_000

// ─── Politique de candidatures (M7) ──────────────────────────────────────────
//
// 10 postulations par heure et par compte candidat (clé
// `candidatures:postulation:<userId>`) : calque exact de D6 — même plafond,
// même fenêtre glissante d'une heure, même règle de consommation
// (`recordAttempt` APRÈS une candidature réellement créée : une tentative
// refusée — doublon, offre indisponible, snapshot refusé — ne consomme pas
// le budget d'une heure). Le seau est porté par le COMPTE, jamais par
// l'offre : il borne le spam de postulations, pas l'audience d'une annonce.
// Fenêtre ÉGALE à MAX_WINDOW_MS : l'invariant de `sweep()` reste couvert à
// l'égalité (verrouillé dans src/lib/rate-limit.test.ts).

/** Postulations max par compte candidat par fenêtre. */
export const CANDIDATURES_MAX_PAR_COMPTE = 10

/** Fenêtre glissante des postulations M7. */
export const CANDIDATURES_WINDOW_MS = 60 * 60 * 1_000

// ─── Politique de messagerie (M8) ────────────────────────────────────────────
//
// 10 messages par minute et par compte (clé `messagerie:envoi:<userId>`) :
// le seau est porté par l'ACTEUR, jamais par la conversation — sinon un
// spammeur contournerait le plafond en ouvrant plusieurs onglets ou en
// écrivant dans plusieurs conversations à la suite. Même règle de
// consommation que M6/M7 : `recordAttempt` APRÈS une écriture réelle (un
// envoi refusé — lecture seule, blocage, taille, conversation d'autrui —
// ne consomme pas le budget d'une minute). Fenêtre COURTE (1 min), très
// en deçà de MAX_WINDOW_MS : l'invariant de `sweep()` reste couvert.

/** Messages max par compte et par fenêtre glissante M8. */
export const MESSAGERIE_MAX_ENVOIS_PAR_COMPTE = 10

/** Fenêtre glissante des envois de messages M8. */
export const MESSAGERIE_ENVOI_WINDOW_MS = 60 * 1_000

// ─── Opérations ──────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  /** Temps d'attente restant avant la libération de la fenêtre. */
  retryAfterMs: number
}

function prune(bucket: Bucket, now: number, windowMs: number): void {
  bucket.attempts = bucket.attempts.filter((t) => now - t < windowMs)
}

function sweep(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [key, bucket] of buckets) {
    if (now - bucket.last > MAX_WINDOW_MS) buckets.delete(key)
  }
}

/** Vérifie si la clé a encore du budget dans sa fenêtre glissante. */
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket) return { allowed: true, retryAfterMs: 0 }

  prune(bucket, now, windowMs)
  if (bucket.attempts.length < max) return { allowed: true, retryAfterMs: 0 }

  const oldest = bucket.attempts[0] ?? now
  return { allowed: false, retryAfterMs: Math.max(windowMs - (now - oldest), 1) }
}

/**
 * Enregistre une occurrence de la clé. Utilisé par M1 pour les tentatives
 * de connexion échouées, par M5 (src/proxy.ts) pour chaque requête
 * publique et par M6 pour les créations d'offres — les espaces de clés
 * (`login:*`, `offres:ip:*`, `offres:creation:*`) restent disjoints.
 *
 * `windowMs` : fenêtre glissante de la clé appelante. Par défaut la fenêtre
 * de connexion (5 min) ; tout appelant d'une fenêtre PLUS LONGUE doit la
 * passer EXPLICITEMENT, sinon le prune ci-dessous tronquerait son
 * historique (et donc son compte) à 5 min — c'est le cas du seau de
 * création M6 (1 h). Le prélèvement de `checkRateLimit` utilise déjà la
 * fenêtre fournie à l'appel.
 */
export function recordAttempt(key: string, windowMs: number = LOGIN_WINDOW_MS): void {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (bucket) {
    prune(bucket, now, windowMs)
    bucket.attempts.push(now)
    bucket.last = now
  } else {
    buckets.set(key, { attempts: [now], last: now })
  }
  sweep(now)
}

/** Libère la fenêtre d'une clé (connexion réussie). */
export function resetAttempts(key: string): void {
  buckets.delete(key)
}
