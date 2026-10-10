import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config'
import { MAX_CV_BYTES, MAX_IMAGE_BYTES } from './lib/files'

// `next.config.ts` n'est PAS couvert par le test de build : un retour en
// arrière du `bodySizeLimit` (défaut Next.js = 1 Mo) casserait silencieusement
// tout upload au-delà de 1 Mo en 413 brut, hors parcours `?erreur=` contrôlé.
// Ce test verrouille la cohérence entre le plafond applicatif (files.ts) et le
// plafond transport (server actions).

/** `8mb` de la doc Next = 8 * 1024 * 1024 (notation octets du SDK). */
const MEGA_OCTET = 1024 * 1024

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
