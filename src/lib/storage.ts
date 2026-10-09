import 'server-only'

import { randomUUID } from 'node:crypto'

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// ─── Stockage objet privé : Cloudflare R2 (compatible S3) ────────────────────
// CHOIX (étape 3 validée) : hébergement Vercel = disque éphémère, donc aucun
// fichier sensible sur le serveur ; bucket R2 STRICTEMENT PRIVÉ, sans frais de
// sortie de trafic (les CV sont du téléchargement pur).
//
// RÈGLES DE SÉCURITÉ de la couche :
// - la base ne stocke QUE la clé (ex. `cvs/<uuid>.pdf`), jamais une URL ;
// - aucun objet n'est publié : ni ACL ouverte, ni URL publique permanente ;
// - un téléchargement = URL signée générée APRÈS vérification de la matrice
//   d'accès (route /api/files/*), valable 5 minutes (SIGNED_URL_TTL_SECONDS) ;
// - les objets sont écrits avec `Cache-Control: private, no-store` et la
//   signature renvoie les mêmes en-têtes (paramètres response-* pris en charge
//   par R2) : ni navigateur, ni intermédiaire ne conserve de copie ;
// - la clé est un UUID serveur : le nom d'origine et tout id prévisible en
//   sont exclus (constat d'étape 1).
//
// Variables requises (voir .env.example) : R2_ENDPOINT, R2_BUCKET,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Le client est créé paresseusement :
// un build sans ces variables ne casse pas, seule une utilisation réelle lève
// une erreur explicite.
// ---------------------------------------------------------------------------

/** Durée de vie d'une URL signée de téléchargement (5 minutes, validé Étape 3). */
export const SIGNED_URL_TTL_SECONDS = 300

interface R2Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name} (stockage R2)`)
  }
  return value
}

function readConfig(): R2Config {
  return {
    endpoint: requireEnv('R2_ENDPOINT'),
    bucket: requireEnv('R2_BUCKET'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  }
}

let sharedClient: S3Client | null = null
let sharedBucket: string | null = null

function s3(): { client: S3Client; bucket: string } {
  if (!sharedClient || !sharedBucket) {
    const config = readConfig()
    sharedClient = new S3Client({
      region: 'auto', // requis par l'API S3 de R2
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
    sharedBucket = config.bucket
  }
  return { client: sharedClient, bucket: sharedBucket }
}

// ─── Génération de clés ──────────────────────────────────────────────────────

/**
 * Génère une clé d'objet privée : préfixe de catégorie + UUID v4
 * (randomUUID, 122 bits d'entropie) + extension normalisée.
 * Jamais le nom d'origine, jamais un identifiant incrémental : même si la
 * base fuyait, aucune adresse de fichier ne serait déductible.
 */
export function generateKey(
  prefix: 'cvs' | 'avatars' | 'logos' | 'candidatures',
  extension: string,
): string {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!ext) {
    throw new Error('Extension de fichier invalide.')
  }
  return `${prefix}/${randomUUID()}.${ext}`
}

// ─── Opérations ──────────────────────────────────────────────────────────────

/** Écrit un objet PRIVÉ (aucune ACL publique) avec en-têtes anti-cache. */
export async function putPrivateObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = s3()
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, no-store, max-age=0',
    }),
  )
}

/**
 * Copie un objet privé vers une NOUVELLE clé (M7, snapshot de CV par
 * candidature) : le fichier reste dans le même bucket privé, sans ACL ni
 * URL publique. `MetadataDirective: 'REPLACE'` + `ContentType` imposé :
 * les en-têtes de sécurité (`private, no-store`, MIME explicite) ne
 * dépendent pas de la configuration de l'objet source — un fichier hérité
 * de la migration legacy ne peut pas réintroduire un cache partageable.
 * La clé cible est GENÉRÉE PAR LE SERVEUR (generateKey) : jamais dérivée
 * d'un identifiant client. À n'invoquer QU'après vérification que la
 * source appartient bien au candidat qui poste.
 */
export async function copyPrivateObject(
  sourceKey: string,
  targetKey: string,
  contentType: string,
): Promise<void> {
  const { client, bucket } = s3()
  // Le CopySource S3 s'écrit « bucket/clé » avec la clé encodée segment
  // par segment (les « / » restent littéraux, tout autre caractère est
  // percent-encodé : pas de traversée de chemin ni d'interprétation).
  const encodedKey = sourceKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodedKey}`,
      Key: targetKey,
      ContentType: contentType,
      CacheControl: 'private, no-store, max-age=0',
      MetadataDirective: 'REPLACE',
    }),
  )
}

interface SignedDownload {
  key: string
  /** Nom affiché au téléchargement (ASCII simple, ex. `cv.pdf`). */
  filename: string
  contentType: string
  /**
   * attachment (défaut) : le navigateur TÉLÉCHARGE, jamais d'interprétation.
   * inline : réservé à l'AVATAR — et uniquement parce que les types images
   * sont blanchis à l'envoi ET à la migration legacy (aucun SVG/HTML possible ;
   * cf. src/lib/files.ts). Servi avec le MIME réel + `nosniff` + `no-store` :
   * aucun vecteur d'exécution ne subsiste pour un format raster.
   */
  disposition?: 'attachment' | 'inline'
}

/**
 * Produit une URL signée de 5 minutes pour UN téléchargement précis.
 * `ResponseContentDisposition`/`ResponseContentType`/`ResponseCacheControl`
 * sont posés à la signature : le fichier ne peut être ouvert « en ligne »
 * (pas d'interprétation HTML/SVG) et ne doit jamais être mis en cache.
 * À n'invoquer QU'après vérification session + matrice d'accès.
 */
export async function signDownloadUrl(download: SignedDownload): Promise<string> {
  const { client, bucket } = s3()
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: download.key,
    ResponseContentDisposition: `${download.disposition ?? 'attachment'}; filename="${download.filename}"`,
    ResponseContentType: download.contentType,
    ResponseCacheControl: 'private, no-store, max-age=0',
  })
  return getSignedUrl(client, command, { expiresIn: SIGNED_URL_TTL_SECONDS })
}

/** Suppression d'un objet (best-effort : un échec ne bloque jamais l'action). */
export async function deleteObject(key: string): Promise<void> {
  try {
    const { client, bucket } = s3()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch {
    // Objet peut-être déjà absent : la suppression reste best-effort.
  }
}

// ─── Métadonnées de téléchargement ───────────────────────────────────────────

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Métadonnées de téléchargement déduites de la CLÉ d'objet (jamais d'un nom
 * d'origine qui ne figure nulle part en base) :
 * - extension sanitisée : minuscules, [a-z0-9]{1,5}, sinon `fallbackExt` ;
 * - MIME correspondant ; extension inconnue → `application/octet-stream`,
 *   que le navigateur télécharge sans jamais interpréter.
 * La signature ajoute par-dessus `Content-Disposition: attachment` +
 * `no-store` : défense en profondeur même si le type réel diffère du déclaré.
 */
export function downloadMeta(
  key: string,
  fallbackExt: string,
): { extension: string; contentType: string } {
  const segment = key.split('/').pop() ?? ''
  const dotIndex = segment.lastIndexOf('.')
  const raw = dotIndex >= 0 ? segment.slice(dotIndex + 1) : ''
  const sanitized = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  const extension =
    sanitized.length >= 1 && sanitized.length <= 5 ? sanitized : fallbackExt.toLowerCase()
  return { extension, contentType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream' }
}
