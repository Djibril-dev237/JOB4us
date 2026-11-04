import { describe, expect, it, vi } from 'vitest'

import nextConfig from '../next.config'
import { MAX_CV_BYTES, MAX_IMAGE_BYTES } from './lib/files'

// `next.config.ts` n'est PAS couvert par le test de build : un retour en
// arrière du `bodySizeLimit` (défaut Next.js = 1 Mo) casserait silencieusement
// tout upload au-delà de 1 Mo en 413 brut, hors parcours `?erreur=` contrôlé.
// Ce test verrouille la cohérence entre le plafond applicatif (files.ts) et le
// plafond transport (server actions).

/** `8mb` de la doc Next = 8 * 1024 * 1024 (notation octets du SDK). */
const MEGA_OCTET = 1024 * 1024

describe('next.config - en-tetes de securite', () => {
  it('applique les en-tetes de base a toutes les routes', async () => {
    const regles = await nextConfig.headers?.()
    expect(regles).toBeDefined()
    expect(regles?.[0]?.source).toBe('/:path*')

    const enTetes = new Map(
      (regles?.[0]?.headers ?? []).map((entree) => [entree.key, entree.value]),
    )
    expect(enTetes.get('X-Content-Type-Options')).toBe('nosniff')
    expect(enTetes.get('X-Frame-Options')).toBe('DENY')
    expect(enTetes.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(enTetes.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    )
  })

  it('n emet jamais HSTS hors production', async () => {
    const regles = await nextConfig.headers?.()
    const enTetes = (regles?.[0]?.headers ?? []).map((entree) => entree.key)
    expect(enTetes).not.toContain('Strict-Transport-Security')
  })

  it('emet HSTS en production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const regles = await nextConfig.headers?.()
      const enTetes = new Map(
        (regles?.[0]?.headers ?? []).map((entree) => [entree.key, entree.value]),
      )
      expect(enTetes.get('Strict-Transport-Security')).toBe(
        'max-age=31536000; includeSubDomains',
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('next.config — experimental.serverActions.bodySizeLimit', () => {
  it('dépasse MAX_CV_BYTES : le garde-fou transport ne bloque jamais un fichier accepté par validateUpload', () => {
    const limite = nextConfig.experimental?.serverActions?.bodySizeLimit

    expect(limite).toBeTypeOf('string')
    expect(String(limite).toLowerCase()).toBe('8mb')
    // 8 Mo > 5 Mo (CV) + marge pour la lettre (3000 car.) et l'encodage
    // multipart — l'inégalité stricte est le verrou.
    expect(8 * MEGA_OCTET).toBeGreaterThan(MAX_CV_BYTES)
    expect(8 * MEGA_OCTET).toBeGreaterThan(MAX_IMAGE_BYTES)
  })
})
