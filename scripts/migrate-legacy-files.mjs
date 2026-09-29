#!/usr/bin/env node
// ─── Migration des fichiers legacy vers le stockage privé R2 ──────────────────
//
// INVENTAIRE ET MIGRATION des colonnes de fichiers héritées de Laravel :
//   Candidat.cvPath, Candidature.cvPath  (dossier legacy `cvs/`)
//   User.avatar                          (dossier legacy `avatars/`)
//   Entreprise.logo                      (dossier legacy `logos/`)
//
// Usage (la base et le dossier legacy sont lus dans les deux modes) :
//   npm run legacy:files                 → DRY-RUN : inventaire, aucune écriture
//   npm run legacy:files -- --apply      → migration réelle
//   npm run legacy:files -- --apply --delete-orphans
//                                         → supprime aussi les fichiers legacy
//                                           sans ligne en base (rapportés sinon)
//
// Garanties de sécurité :
// - DRY-RUN PAR DÉFAUT : sans --apply, aucun octet n'est écrit, aucune
//   colonne modifiée, aucun fichier supprimé ;
// - chaque fichier est relu (octets de tête) et n'est migré QUE si son type
//   réel appartient à la liste blanche de sa catégorie — un type interdit
//   (SVG…) n'est JAMAIS uploadé et sa colonne reste intacte pour arbitrage ;
// - la clé R2 est un UUID neuf : aucun nom legacy n'est réutilisé ;
// - upload PRIVÉ (Cache-Control: private, no-store) puis mise à jour de la
//   base, puis suppression du fichier legacy uniquement si tout a réussi
//   (jamais de perte de données) ;
// - les anciennes URL /storage/* cessent de répondre d'elles-mêmes en
//   production (pas de PHP) ; la suppression des fichiers ici garantit
//   également qu'aucune copie ne subsiste localement.
//
// Variables requises : DATABASE_URL (toujours), R2_* (uniquement avec
// --apply). Chargées depuis .env par `node --env-file=.env`.
//
// NOTE : la détection de type ci-dessous reprend volontairement les mêmes
// signatures binaires que src/lib/files.ts — un script Node brut ne peut pas
// importer un module TypeScript sans bundler ; en cas d'évolution de la
// liste blanche, les deux fichiers doivent être mis à jour ensemble.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'

const LEGACY_ROOT = path.resolve('legacy_laravel', 'storage', 'app', 'public')
const APPLY = process.argv.includes('--apply')
const DELETE_ORPHANS = process.argv.includes('--delete-orphans')

// ─── Liste blanche (identique à src/lib/files.ts) ────────────────────────────

const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

const CV_TYPES = ['pdf', 'doc', 'docx']
const IMAGE_TYPES = ['jpg', 'png', 'webp', 'gif']

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

function detectFile(bytes) {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'docx'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

function generateKey(prefix, extension) {
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!ext) throw new Error('Extension invalide.')
  return `${prefix}/${randomUUID()}.${ext}`
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[ERREUR] Variable d'environnement manquante : ${name}`)
    process.exit(1)
  }
  return value
}

/** Une clé R2 déjà migrée (UUID) n'est pas un chemin legacy. */
function isAlreadyMigrated(value) {
  const base = value.split('/').pop() ?? ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/.test(base)
}

/**
 * Résout la valeur en base vers un fichier sous LEGACY_ROOT.
 * Les formes exactes héritées de Laravel ne sont pas supposées : plusieurs
 * préfixes plausibles sont essayés et le rapport signale ce qui reste introuvable.
 */
function findLegacyFile(value) {
  const clean = value.replace(/^\/+/, '')
  const candidates = [clean]
  if (clean.startsWith('storage/')) candidates.push(clean.slice('storage/'.length))
  if (clean.startsWith('public/')) candidates.push(clean.slice('public/'.length))
  if (clean.startsWith('storage/app/public/')) candidates.push(clean.slice('storage/app/public/'.length))

  for (const candidate of candidates) {
    const full = path.join(LEGACY_ROOT, candidate)
    if (full.startsWith(LEGACY_ROOT) && existsSync(full)) return full
  }
  return null
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full))
    else out.push(full)
  }
  return out
}

// ─── Catégories : lecture BDD / écriture BDD / dossier legacy ───────────────

function buildCategories(prisma) {
  return [
    {
      nom: 'CV de profil (Candidat.cvPath)',
      dossier: 'cvs',
      types: CV_TYPES,
      lire: () => prisma.candidat.findMany({ where: { cvPath: { not: null } }, select: { id: true, cvPath: true } }),
      valeur: (row) => row.cvPath,
      label: (row) => `candidat #${row.id}`,
      maj: (row, key) => prisma.candidat.update({ where: { id: row.id }, data: { cvPath: key } }),
    },
    {
      nom: 'CV de candidature (Candidature.cvPath)',
      dossier: 'cvs',
      types: CV_TYPES,
      lire: () => prisma.candidature.findMany({ where: { cvPath: { not: null } }, select: { id: true, cvPath: true } }),
      valeur: (row) => row.cvPath,
      label: (row) => `candidature #${row.id}`,
      maj: (row, key) => prisma.candidature.update({ where: { id: row.id }, data: { cvPath: key } }),
    },
    {
      nom: 'Photo de profil (User.avatar)',
      dossier: 'avatars',
      types: IMAGE_TYPES,
      lire: () => prisma.user.findMany({ where: { avatar: { not: null } }, select: { id: true, avatar: true } }),
      valeur: (row) => row.avatar,
      label: (row) => `utilisateur #${row.id}`,
      maj: (row, key) => prisma.user.update({ where: { id: row.id }, data: { avatar: key } }),
    },
    {
      nom: "Logo d'entreprise (Entreprise.logo)",
      dossier: 'logos',
      types: IMAGE_TYPES,
      lire: () => prisma.entreprise.findMany({ where: { logo: { not: null } }, select: { id: true, logo: true } }),
      valeur: (row) => row.logo,
      label: (row) => `entreprise #${row.id}`,
      maj: (row, key) => prisma.entreprise.update({ where: { id: row.id }, data: { logo: key } }),
    },
  ]
}

// ─── Exécution ───────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient()
  const stats = { migres: 0, dejaMigres: 0, refuses: 0, introuvables: 0, lignes: 0 }
  const fichiersUtilises = new Set()

  /** Construit le client S3 seulement en mode --apply (les clés R2 ne sont alors plus optionnelles). */
  let s3 = null
  let bucket = null
  if (APPLY) {
    bucket = requireEnv('R2_BUCKET')
    s3 = new S3Client({
      region: 'auto',
      endpoint: requireEnv('R2_ENDPOINT'),
      credentials: {
        accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      },
    })
  }

  console.log(`Mode : ${APPLY ? 'APPLY (migrations réelles)' : 'DRY-RUN (aucune écriture)'}`)
  console.log(`Racine legacy : ${LEGACY_ROOT}`)
  if (!existsSync(LEGACY_ROOT)) {
    console.warn('[AVERTISSEMENT] Dossier legacy introuvable : inventaire BDD uniquement.')
  }
  console.log('')

  for (const cat of buildCategories(prisma)) {
    const rows = await cat.lire()
    console.log(`── ${cat.nom} : ${rows.length} ligne(s) avec chemin`)

    for (const row of rows) {
      stats.lignes += 1
      const value = cat.valeur(row)
      const etiq = `${cat.label(row)} ← ${value}`

      if (isAlreadyMigrated(value)) {
        stats.dejaMigres += 1
        console.log(`   [IGNORÉ] ${etiq} : clé UUID déjà migrée`)
        continue
      }

      const fichier = findLegacyFile(value)
      if (!fichier) {
        stats.introuvables += 1
        console.log(`   [ÉCHEC]  ${etiq} : fichier legacy introuvable (colonne inchangée)`)
        continue
      }
      fichiersUtilises.add(path.resolve(fichier))

      const bytes = readFileSync(fichier)
      const type = detectFile(bytes)
      if (!type || !cat.types.includes(type)) {
        stats.refuses += 1
        const vue = type ?? 'inconnu'
        console.log(
          `   [REFUSÉ] ${etiq} : type réel « ${vue} » hors liste blanche (${cat.types.join(', ')}) — colonne inchangée, arbitrage manuel requis`,
        )
        continue
      }

      const key = generateKey(cat.dossier, type)
      if (!APPLY) {
        console.log(`   [PRÊT]   ${etiq} → R2:${key} (${bytes.length} o, ${type}) — relancer avec --apply`)
        continue
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: MIME_BY_EXTENSION[type],
          CacheControl: 'private, no-store, max-age=0',
        }),
      )
      await cat.maj(row, key)
      unlinkSync(fichier)
      stats.migres += 1
      console.log(`   [MIGRÉ]  ${etiq} → R2:${key} (base mise à jour, fichier legacy supprimé)`)
    }
  }

  // ── Fichiers legacy sans aucune ligne en base (orphelins) ──
  const orphelins = ['cvs', 'avatars', 'logos']
    .flatMap((dossier) => listFilesRecursive(path.join(LEGACY_ROOT, dossier)))
    .map((f) => path.resolve(f))
    .filter((f) => !fichiersUtilises.has(f))

  console.log('')
  if (orphelins.length > 0) {
    console.log(`── Fichiers legacy orphelins (aucune ligne en base) : ${orphelins.length}`)
    for (const orphan of orphelins) {
      const rel = path.relative(LEGACY_ROOT, orphan)
      if (APPLY && DELETE_ORPHANS) {
        unlinkSync(orphan)
        console.log(`   [SUPPRIMÉ] ${rel}`)
      } else {
        console.log(`   [RAPPORT]  ${rel} — supprimable avec --apply --delete-orphans`)
      }
    }
  } else {
    console.log('── Aucun fichier legacy orphelin.')
  }

  console.log('')
  console.log(
    `Bilan : ${stats.lignes} ligne(s) en base | ${APPLY ? stats.migres + ' migrée(s)' : '0 migrée (dry-run)'} | ` +
      `${stats.dejaMigres} déjà migrée(s) | ${stats.refuses} refusée(s) | ${stats.introuvables} introuvable(s) | ` +
      `${orphelins.length} orphelin(s)`,
  )

  await prisma.$disconnect()
  if (s3) s3.destroy()
}

main().catch((error) => {
  console.error('[ERREUR FATALE]', error)
  process.exit(1)
})
