import { describe, expect, it } from 'vitest'

import { detectFile, MAX_CV_BYTES, validateUpload } from './files'

// ─── Fabrication d'octets et de fichiers de test ─────────────────────────────

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

const PDF = bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37) // "%PDF-1.7"
const OLE2 = bytesOf(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) // .doc
const ZIP = bytesOf(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00) // .docx
const JPG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46)
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const GIF = bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00)
const WEBP = bytesOf(
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, // "RIFF" + taille
  0x57, 0x45, 0x42, 0x50, // "WEBP"
)
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')

function fileOf(bytes: Uint8Array, name = 'fichier', type = 'application/octet-stream'): File {
  return new File([bytes as unknown as BlobPart], name, { type })
}

// ─── Détection du type réel ───────────────────────────────────────────────────

describe('detectFile (octets de tête)', () => {
  it('reconnait les formats autorisés', () => {
    expect(detectFile(PDF)?.extension).toBe('pdf')
    expect(detectFile(OLE2)?.extension).toBe('doc')
    expect(detectFile(ZIP)?.extension).toBe('docx')
    expect(detectFile(JPG)?.extension).toBe('jpg')
    expect(detectFile(PNG)?.extension).toBe('png')
    expect(detectFile(GIF)?.extension).toBe('gif')
    expect(detectFile(WEBP)?.extension).toBe('webp')
  })

  it('refuse SVG, HTML et tout contenu inconnu (XSS stocké bloqué)', () => {
    expect(detectFile(SVG)).toBeNull()
    expect(detectFile(HTML)).toBeNull()
    expect(detectFile(bytesOf(0x00, 0x01, 0x02, 0x03))).toBeNull()
    expect(detectFile(bytesOf())).toBeNull()
  })

  it('retourne un MIME correspondant a l extension detectee', () => {
    expect(detectFile(PDF)?.mime).toBe('application/pdf')
    expect(detectFile(JPG)?.mime).toBe('image/jpeg')
  })
})

// ─── validateUpload : CV ──────────────────────────────────────────────────────

describe('validateUpload pour un CV', () => {
  it('accepte un vrai PDF', async () => {
    const result = await validateUpload(fileOf(PDF, 'cv.pdf', 'application/pdf'), 'cv')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.extension).toBe('pdf')
    }
  })

  it('refuse une image envoyee comme CV (type reel, pas le nom)', async () => {
    const result = await validateUpload(fileOf(PNG, 'cv.pdf', 'application/pdf'), 'cv')
    expect(result).toEqual({
      ok: false,
      error: 'Format non autorisé. Formats acceptés : pdf, doc, docx.',
    })
  })

  it('refuse SVG et HTML meme renommes en .pdf', async () => {
    const svg = await validateUpload(fileOf(SVG, 'cv.pdf'), 'cv')
    const html = await validateUpload(fileOf(HTML, 'cv.pdf'), 'cv')
    expect(svg.ok).toBe(false)
    expect(html.ok).toBe(false)
  })

  it('refuse un fichier absent ou vide', async () => {
    expect(await validateUpload(null, 'cv')).toEqual({ ok: false, error: 'Fichier manquant.' })
    expect(await validateUpload(fileOf(bytesOf()), 'cv')).toEqual({
      ok: false,
      error: 'Fichier manquant.',
    })
  })

  it('refuse un fichier plus gros que 5 Mo avant toute ecriture', async () => {
    const oversized = new File([new Uint8Array(MAX_CV_BYTES + 1)], 'gros.pdf')
    const result = await validateUpload(oversized, 'cv')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('5 Mo')
    }
  })
})

// ─── validateUpload : photo de profil ────────────────────────────────────────

describe('validateUpload pour un avatar', () => {
  it('accepte un vrai JPEG', async () => {
    const result = await validateUpload(fileOf(JPG, 'photo.jpg', 'image/jpeg'), 'avatar')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.file.extension).toBe('jpg')
    }
  })

  it('refuse un PDF envoye comme image', async () => {
    const result = await validateUpload(fileOf(PDF, 'photo.png', 'image/png'), 'avatar')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('jpg, png, webp, gif')
    }
  })

  it('refuse SVG (vecteur de XSS stocke) meme signe image/svg+xml', async () => {
    const svg = fileOf(SVG, 'photo.svg', 'image/svg+xml')
    expect(await validateUpload(svg, 'avatar')).toEqual({
      ok: false,
      error: 'Format non autorisé. Formats acceptés : jpg, png, webp, gif.',
    })
  })
})
