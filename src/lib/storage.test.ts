import { describe, expect, it } from 'vitest'

import { downloadMeta, generateKey, SIGNED_URL_TTL_SECONDS } from './storage'

// ─── Règles de la couche stockage (Étape 3 validée) ──────────────────────────

describe('durée de vie des URL signées', () => {
  it('expire après 5 minutes exactement (règle validée Étape 3)', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(300)
  })
})

describe('generateKey', () => {
  it('produit des clés UUID uniques, non devinables, par catégorie', () => {
    const a = generateKey('cvs', 'pdf')
    const b = generateKey('cvs', 'pdf')

    expect(a).toMatch(/^cvs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/)
    expect(a).not.toBe(b)
    expect(generateKey('avatars', 'png')).toMatch(/^avatars\//)
    expect(generateKey('logos', 'jpg')).toMatch(/^logos\//)
  })

  it("normalise l'extension (minuscules) et refuse une extension vide", () => {
    expect(generateKey('avatars', 'JPG')).toMatch(/\.jpg$/)
    expect(() => generateKey('cvs', '///')).toThrow('Extension de fichier invalide.')
    expect(() => generateKey('cvs', '')).toThrow()
  })

  it('ne conserve jamais un nom de fichier original', () => {
    const key = generateKey('cvs', 'pdf')
    expect(key).not.toContain(' ')
    expect(key.split('/').pop()).not.toContain('cv')
  })
})

describe('downloadMeta', () => {
  it('déduit extension et MIME de la clé (pas dunom déclaré)', () => {
    expect(downloadMeta('cvs/ancien/scan-final.PDF', 'pdf')).toEqual({
      extension: 'pdf',
      contentType: 'application/pdf',
    })
    expect(downloadMeta('avatars/uuid.JPG', 'png')).toEqual({
      extension: 'jpg',
      contentType: 'image/jpeg',
    })
  })

  it("tombe sur application/octet-stream pour une extension inconnue", () => {
    expect(downloadMeta('cvs/uuid.exe', 'pdf')).toEqual({
      extension: 'exe',
      contentType: 'application/octet-stream',
    })
  })

  it("retombe sur l'extension par défaut si absente ou malformée", () => {
    expect(downloadMeta('cvs/sans-extension', 'pdf').extension).toBe('pdf')
    expect(downloadMeta('cvs/file.TOOLONGEXT', 'pdf').extension).toBe('pdf')
    expect(downloadMeta('cvs/file.///', 'pdf').extension).toBe('pdf')
  })
})
