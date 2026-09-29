import 'server-only'

import { randomUUID } from 'node:crypto'

import {
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
  prefix: 'cvs' | 'avatars' | 'logos',
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

interface SignedDownload {
  key: string
  /** Nom affiché au téléchargement (ASCII simple, ex. `cv.pdf`). */
  filename: string
  contentType: string
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
    ResponseContentDisposition: `attachment; filename="${download.filename}"`,
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
