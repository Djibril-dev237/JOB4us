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

/** Fenêtre maximale utilisée par ce module : sert à la purge des clés orphelines. */
const MAX_WINDOW_MS = 15 * 60 * 1_000

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
 * de connexion échouées ET par M5 (src/proxy.ts) pour chaque requête
 * publique — les espaces de clés (`login:*` / `offres:*`) restent disjoints.
 */
export function recordAttempt(key: string): void {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (bucket) {
    prune(bucket, now, LOGIN_WINDOW_MS)
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
