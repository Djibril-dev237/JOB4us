#!/usr/bin/env node
// ─── CLI d'administration Job4Us (M10) ───────────────────────────────────────
//
// Usage :
//   npm run admin -- invite --email admin@exemple.cm --name "Ada Admin"
//   npm run admin -- reprise --email admin@exemple.cm
//
// `invite` crée un compte admin INACTIF (aucun mot de passe, aucun TOTP) et
// émet un jeton d'activation à usage unique valable 24 h. `reprise` réémet une
// invitation pour un admin existant qui n'a pas encore activé son TOTP.
//
// Aucune promotion depuis candidat/recruteur : un email déjà utilisé par un
// autre rôle est refusé. Aucun secret n'est journalisé : le jeton est affiché
// UNE fois sur la sortie standard, la base n'en garde que le hash.
//
// Le script partage la cryptographie de l'application (src/lib/admin-crypto.ts)
// via le type stripping natif de Node 24. Lancer avec --env-file=.env.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client'

import {
  genererJeton,
  hacherJeton,
} from '../src/lib/admin-crypto.ts'

const prisma = new PrismaClient()
const ACTEUR_SYSTEME = 0
const DUREE_INVITATION_MS = 24 * 60 * 60 * 1000

function arg(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const valeur = process.argv[index + 1]
  if (!valeur || valeur.startsWith('--')) return undefined
  return valeur.trim()
}

function aide() {
  console.log(`Commandes :
  invite --email <email> --name <nom>   Crée un admin inactif et une invitation 24 h
  reprise --email <email>               Réémet une invitation pour un admin sans TOTP

Options :
  --help                                Affiche cette aide`)
}

function emailValide(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function urlActivation(token) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}/activation-admin/${token}`
}

function afficherInvitation(token, email) {
  console.log('')
  console.log(`Invitation créée pour ${email}.`)
  console.log('Lien à usage unique, valable 24 heures :')
  console.log(urlActivation(token))
  console.log('')
  console.log("Le jeton n'est plus affichable ensuite. Transmettez-le par un canal sûr.")
}

async function ecrireAudit(tx, { action, cibleId, commentaire }) {
  await tx.journalAudit.create({
    data: {
      acteurId: ACTEUR_SYSTEME,
      action,
      cibleType: 'admin',
      cibleId,
      motif: null,
      commentaire,
    },
  })
}

async function invitation({ reprise }) {
  const email = arg('--email')
  const name = arg('--name') ?? email
  if (!emailValide(email)) {
    console.error('[ERREUR] --email valide requis.')
    process.exitCode = 1
    return
  }

  const existant = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      password: true,
      isActive: true,
      totpEnabledAt: true,
      anonymizedAt: true,
    },
  })

  if (!reprise && existant) {
    if (existant.role !== 'admin') {
      console.error(
        '[ERREUR] Cet email appartient à un compte candidat/recruteur. La promotion est interdite.',
      )
      process.exitCode = 1
      return
    }
    if (existant.totpEnabledAt !== null) {
      console.error('[ERREUR] Ce compte admin est déjà activé (TOTP présent).')
      process.exitCode = 1
      return
    }
    console.error(
      '[ERREUR] Un compte admin sans TOTP existe déjà. Utilisez la commande reprise.',
    )
    process.exitCode = 1
    return
  }

  if (reprise && !existant) {
    console.error('[ERREUR] Aucun compte admin à reprendre pour cet email.')
    process.exitCode = 1
    return
  }

  if (reprise && existant) {
    if (
      existant.role !== 'admin' ||
      existant.totpEnabledAt !== null ||
      existant.anonymizedAt !== null ||
      (!existant.isActive && existant.password !== null)
    ) {
      console.error(
        '[ERREUR] Ce compte ne peut pas être repris (rôle, TOTP, anonymisation ou suspension).',
      )
      process.exitCode = 1
      return
    }
  }

  if (!reprise && (typeof name !== 'string' || name.length < 2 || name.length > 100)) {
    console.error('[ERREUR] --name doit contenir entre 2 et 100 caractères.')
    process.exitCode = 1
    return
  }

  const token = genererJeton()
  const tokenHash = hacherJeton(token)
  const expiresAt = new Date(Date.now() + DUREE_INVITATION_MS)

  const resultat = await prisma.$transaction(async (tx) => {
    let utilisateur = existant
    if (!reprise) {
      utilisateur = await tx.user.create({
        data: {
          name,
          email,
          role: 'admin',
          isActive: false,
          password: null,
        },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          password: true,
          isActive: true,
          totpEnabledAt: true,
          anonymizedAt: true,
        },
      })
    }

    if (!utilisateur) throw new Error('Compte introuvable.')

    await tx.adminInvitation.updateMany({
      where: {
        userId: utilisateur.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    })
    await tx.adminInvitation.create({
      data: { userId: utilisateur.id, tokenHash, expiresAt },
    })
    await ecrireAudit(tx, {
      action: reprise ? 'reprise_admin' : 'invitation_admin',
      cibleId: utilisateur.id,
      commentaire: reprise
        ? 'Invitation de reprise émise par la CLI'
        : 'Invitation admin émise par la CLI',
    })
    return utilisateur
  })

  afficherInvitation(token, resultat.email ?? email)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.length < 3) {
    aide()
    return
  }
  const commande = process.argv[2]
  if (commande === 'invite') {
    await invitation({ reprise: false })
    return
  }
  if (commande === 'reprise') {
    await invitation({ reprise: true })
    return
  }
  console.error(`[ERREUR] Commande inconnue : ${commande}`)
  aide()
  process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('[ERREUR]', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
