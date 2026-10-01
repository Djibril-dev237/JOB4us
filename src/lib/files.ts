// ─── Validation des fichiers uploadés ────────────────────────────────────────
// Constat d'étape 1 corrigé : le legacy validait le contenu (règles `mimes`/
// `image` de Laravel) MAIS la règle `image` de Laravel 10 acceptait le SVG,
// servi depuis notre domaine = vecteur de XSS stocké. ICI :
// - le TYPE RÉEL est lu dans les octets de tête (magic bytes) ; l'extension et
//   le Content-Type déclarés par le navigateur sont ignorés (tous deux forgés
//   en toute simplicité côté client) ;
// - liste blanche stricte par usage : CV = pdf/doc/docx, image = jpg/png/webp/
//   gif — SVG REFUSÉ explicitement pour l'avatar comme pour le logo ;
// - taille maximale contrôlée AVANT toute écriture (5 Mo CV / 2 Mo photo,
//   hérités des limites legacy 5120 Ko / 2048 Ko) ;
// - le fichier est envoyé au stockage sous le type DÉTECTÉ, jamais sous celui
//   déclaré par le client, et la clé générée depuis l'extension détectée.
// Limite connue et assumée : un octet de tête peut être imité — la défense
// finale reste le Content-Disposition: attachment + no-store de la signature
// (cf. storage.ts), qui empêche toute interprétation du contenu par le
// navigateur, quelle que soit sa nature réelle.
// ---------------------------------------------------------------------------

export type CvExtension = 'pdf' | 'doc' | 'docx'
export type ImageExtension = 'jpg' | 'png' | 'webp' | 'gif'
export type FileExtension = CvExtension | ImageExtension

export type UploadKind = 'cv' | 'avatar' | 'logo'

export interface DetectedFile {
  extension: FileExtension
  mime: string
}

/** 5 Mo : hérité de la limite legacy `max:5120` (Ko) des CV. */
export const MAX_CV_BYTES = 5 * 1024 * 1024
/** 2 Mo : hérité de la limite legacy `max:2048` (Ko) des images. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const MIME_BY_EXTENSION: Record<FileExtension, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

const ALLOWED_BY_KIND: Record<UploadKind, readonly FileExtension[]> = {
  cv: ['pdf', 'doc', 'docx'],
  avatar: ['jpg', 'png', 'webp', 'gif'],
  // Même liste blanche d'images que l'avatar (SVG refusé, cf. en-tête).
  logo: ['jpg', 'png', 'webp', 'gif'],
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) {
      return false
    }
  }
  return true
}

/**
 * Lit les octets de tête et retourne le type RÉEL du fichier, ou null si
 * non reconnu (refus). Aucune dépendance externe : signatures binaires.
 */
export function detectFile(bytes: Uint8Array): DetectedFile | null {
  const found = (extension: FileExtension): DetectedFile => ({
    extension,
    mime: MIME_BY_EXTENSION[extension],
  })

  // PDF : "%PDF-"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return found('pdf')
  }
  // .doc (ancien format OLE2/CFB) : d0 cf 11 e0 a1 b1 1a e1
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return found('doc')
  }
  // .docx (OOXML = conteneur ZIP) : PK\x03\x04.
  // Un ZIP non-OOXML serait accepté comme docx : risque jugé nul (contenu
  // sans interprétation directe, toujours servi en attachment), identique
  // à la couverture des `mimes:docx` legacy.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return found('docx')
  }
  // JPEG : ff d8 ff
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return found('jpg')
  }
  // PNG : 89 50 4e 47 0d 0a 1a 0a
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return found('png')
  }
  // GIF87a / GIF89a : "GIF8"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return found('gif')
  }
  // WebP : "RIFF" + "WEBP" à l'offset 8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return found('webp')
  }
  // Tout le reste (XML, SVG, HTML, binaire inconnu…) est refusé.
  return null
}

export type ValidationResult =
  | { ok: true; file: DetectedFile; bytes: Uint8Array }
  | { ok: false; error: string }

/**
 * Valide un fichier reçu en server action : présence, taille, type réel.
 * La validation est purement descendante : aucun octet n'est écrit ni envoyé
 * au stockage tant que tout n'est pas conforme.
 */
export async function validateUpload(
  file: File | null | undefined,
  kind: UploadKind,
): Promise<ValidationResult> {
  if (!file || file.size === 0) {
    return { ok: false, error: 'Fichier manquant.' }
  }

  const max = kind === 'cv' ? MAX_CV_BYTES : MAX_IMAGE_BYTES
  if (file.size > max) {
    const maxMo = max / (1024 * 1024)
    return { ok: false, error: `Fichier trop volumineux (taille maximale : ${maxMo} Mo).` }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const detected = detectFile(bytes)
  const allowed = ALLOWED_BY_KIND[kind]
  if (!detected || !allowed.includes(detected.extension)) {
    return {
      ok: false,
      error: `Format non autorisé. Formats acceptés : ${allowed.join(', ')}.`,
    }
  }

  return { ok: true, file: detected, bytes }
}
