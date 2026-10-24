import 'server-only'

import type { Prisma } from '@prisma/client'

import {
  METADONNEES,
  emailActif,
  type TypeNotification,
} from '@/lib/notifications-labels'
import {
  construireEmailNotificationRendue,
  construireEmailResumeQuotidien,
  type EmailConstruit,
} from '@/lib/notifications-emails'
import { envoyerEmail, estEnvoiConfigure } from '@/lib/notifications-envoi'
import { liensEmail } from '@/lib/notifications-liens'
import { prisma } from '@/lib/prisma'

// ─── File d'envoi des emails (M9, Vague 3) ──────────────────────────────────
//
// L'outbox `EmailNotification` est DURABLE et découplée : l'émission (hooks
// M7/M8) empile une ligne, un cron la draine. Ce module est le SEUL à faire
// avancer les statuts (`enAttente` → `envoye` | `abandonne`) et le seul à
// appeler Resend.
//
// GARANTIES :
//  * IDEMPOTENCE / PAS DE DOUBLE ENVOI : chaque ligne est « réclamée » par un
//    `updateMany` conditionnel (statut enAttente + échéance due) qui repousse
//    `prochaineTentative` de `VERROU_MS` ; deux crons concurrents ne peuvent
//    donc pas envoyer la même ligne (le perdant obtient count 0). Une ligne
//    dont le processus meurt après réclamation redevient due au bout du
//    verrou, sans perte. LIVRAISON AU MOINS UNE FOIS assumée : un crash
//    ENTRE l'acceptation Resend et l'écriture `envoye` provoque un renvoi au
//    passage suivant (Resend et MySQL ne partagent pas de transaction).
//  * JAMAIS BLOQUANT : une panne réseau/Resend n'interrompt pas le lot — la
//    ligne reçoit un code d'erreur court et une échéance de reprise ; après
//    `MAX_TENTATIVES` elle passe `abandonne` (aucune boucle infinie).
//  * PRÉFÉRENCES REVÉRIFIÉES À L'ENVOI : un email empilé hier ne part pas si
//    le compte s'est désabonné entre-temps (`emailsActives = false`) ou a
//    coupé ce type ; `signalementRecu` (non désactivable) traverse toujours le
//    kill switch. Une ligne devenue interdite est `abandonne` avec le code
//    `desactive` — elle ne repartira pas si le compte se réactive, le contenu
//    étant daté.
//  * PLAFONDS ANTI-INONDATION : 6 emails/heure et 30/24 h par destinataire,
//    comptés sur `envoyeLe` (emails RÉELLEMENT partis). Au-delà, la ligne est
//    reportée (1 h ou 24 h) SANS consommer de tentative.
//  * DIGEST : `preparerResumesQuotidiens` crée au plus UNE ligne par compte et
//    par jour UTC (unicité `destinataireId, resumeDu` + clé), uniquement si le
//    compte a activé le résumé ET qu'au moins une notification éligible existe
//    dans la fenêtre [J-1, J). Les lignes sont reconstruites À L'ENVOI depuis
//    les notifications non déjà envoyées individuellement, en respectant les
//    préférences par type. Aucune ligne vide n'est créée ni envoyée.
//  * AUCUNE PII DANS LES ERREURS : seuls les codes rendus par
//    notifications-envoi.ts (`http_422`, `reseau`…) et nos codes internes
//    (`desactive`, `resume_vide`…) sont stockés ; jamais d'adresse, jamais de
//    corps de réponse.
//
// FUSEAU : le digest découpe les jours en UTC (début de journée UTC), choix
// déterministe et testable ; la fenêtre couvre les 24 h qui précèdent ce
// début, donc « depuis hier » quel que soit l'instant du cron dans la journée.
// ---------------------------------------------------------------------------

/** Tentatives MAXIMALES avant abandon propre (3 échecs d'envoi). */
export const MAX_TENTATIVES = 3

/** Plafond d'emails réellement envoyés sur une heure glissante. */
export const PLAFOND_HEURE = 6

/** Plafond d'emails réellement envoyés sur 24 h glissantes. */
export const PLAFOND_JOUR = 30

/** Taille d'un lot : borne la durée d'un passage de cron. */
export const TAILLE_LOT = 50

/** Nombre maximal de lignes d'un résumé (borne la taille de l'email). */
export const MAX_LIGNES_RESUME = 50

/**
 * Un digest plus vieux que 48 h ne part plus : son contenu est daté
 * (« depuis hier ») et un backlog après panne ne doit pas envoyer un résumé
 * trompeur. La ligne est abandonnée, le digest du jour courant reste possible.
 */
export const PEREMPTION_RESUME_MS = 48 * 60 * 60 * 1000

const HEURE_MS = 60 * 60 * 1000
const JOUR_MS = 24 * HEURE_MS

/** Budget d'un passage : le cron ne dépasse jamais ~45 s, même si Resend rame. */
const BUDGET_DRAIN_MS = 45_000

/** Durée de la réclamation anti-double-envoi (crash → redevient due après). */
const VERROU_MS = 10 * 60 * 1000

/** Première reprise 5 min, puis 20 min (×4) : jamais de martèlement. */
const DELAI_REPRISE_BASE_MS = 5 * 60 * 1000

/** Compteurs d'un passage de file : aucune donnée personnelle. */
export interface BilanFile {
  /** Faux si Resend ou le secret de désabonnement manque (aucune ligne lue). */
  configuration: boolean
  examines: number
  envoyes: number
  reportes: number
  echecs: number
  abandons: number
}

/** Compteurs de la préparation des digests. */
export interface BilanResumes {
  /** Comptes ayant le résumé quotidien explicitement activé. */
  candidats: number
  /** Lignes de digest réellement créées (idempotent : 0 au second passage). */
  crees: number
}

/** Réglages d'un destinataire chargés une fois par lot. */
interface ReglagesDestinataire {
  emailsActives: boolean
  preferences: Map<TypeNotification, boolean>
}

/** Ligne de file telle que drainée (relations minimales). */
interface LigneFile {
  id: number
  destinataireId: number
  notificationId: number | null
  type: TypeNotification | null
  resumeDu: Date | null
  tentatives: number
  notification: {
    titre: string
    contenu: string | null
    compteur: number
    type: TypeNotification
  } | null
  destinataire: { email: string | null }
}

/** Compteurs glissants d'un destinataire (envoyés heure / jour). */
interface PlafondsDestinataire {
  heure: number
  jour: number
}

/** Début de journée UTC : frontière STABLE du digest. */
function debutJourUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** `AAAA-MM-JJ` du début de journée (clé idempotente, ASCII). */
function jourCle(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Préférence EFFECTIVE d'un type donné, recalculée à l'envoi : les défauts
 * viennent de `METADONNEES` (ligne absente = défaut), un `signalementRecu`
 * reste toujours autorisé. `type === null` = digest : seul le kill switch
 * s'applique.
 */
function emailAutorise(
  reglages: ReglagesDestinataire,
  type: TypeNotification | null,
): boolean {
  if (type === null) return reglages.emailsActives
  if (!METADONNEES[type].desactivable) return true
  if (!reglages.emailsActives) return false
  return emailActif(type, reglages.preferences.get(type) ?? null)
}

/** Charge réglages + préférences d'un destinataire (2 lectures bornées). */
async function chargerReglages(destinataireId: number): Promise<ReglagesDestinataire> {
  const [reglage, preferences] = await Promise.all([
    prisma.notificationReglage.findUnique({
      where: { userId: destinataireId },
      select: { emailsActives: true },
    }),
    prisma.notificationPreference.findMany({
      where: { userId: destinataireId },
      select: { type: true, emailActive: true },
    }),
  ])

  return {
    emailsActives: reglage?.emailsActives !== false,
    preferences: new Map(preferences.map((ligne) => [ligne.type, ligne.emailActive])),
  }
}

/**
 * Lignes du digest d'une journée : notifications de la fenêtre [J-1, J),
 * SANS email individuel empilé (relation `emails` vide), filtrées par les
 * préférences effectives du destinataire. Les 50 plus récentes sont retenues
 * (borne de taille), puis rendues en ordre chronologique.
 */
async function lignesResume(
  destinataireId: number,
  resumeDu: Date,
  reglages: ReglagesDestinataire,
): Promise<{ titre: string; contenu: string }[]> {
  const notifications = await prisma.notification.findMany({
    where: {
      userId: destinataireId,
      createdAt: { gte: new Date(resumeDu.getTime() - JOUR_MS), lt: resumeDu },
      emails: { none: {} },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_LIGNES_RESUME,
    select: { type: true, titre: true, contenu: true },
  })

  const lignes = notifications
    .filter((notification) => emailAutorise(reglages, notification.type))
    .map((notification) => ({
      titre: notification.titre,
      contenu: notification.contenu ?? '',
    }))

  return lignes.reverse()
}

/**
 * Crée les lignes de digest du jour, UNE fois par compte et par jour UTC.
 * Idempotent par `createMany({ skipDuplicates: true })` : les deux unicités
 * (clé et `destinataireId + resumeDu`) sont posées en base. Rend le nombre de
 * lignes réellement créées (0 au rejeu).
 */
export async function preparerResumesQuotidiens(
  maintenant: Date = new Date(),
): Promise<BilanResumes> {
  // Même disponibilité que le drain : sans Resend ou sans secret de
  // désabonnement, ne pas accumuler de digests qui seraient périmés au
  // moment où l'envoi deviendra possible.
  if (!estEnvoiConfigure() || !process.env.AUTH_SECRET?.trim()) {
    return { candidats: 0, crees: 0 }
  }

  const resumeDu = debutJourUtc(maintenant)
  const comptes = await prisma.notificationReglage.findMany({
    where: { resumeQuotidien: true, emailsActives: true },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  })

  const donnees: Prisma.EmailNotificationCreateManyInput[] = []

  for (const { userId } of comptes) {
    const reglages = await chargerReglages(userId)
    // Revérification (le filtre SQL suffit, mais une course reste possible).
    if (!emailAutorise(reglages, null)) continue

    const lignes = await lignesResume(userId, resumeDu, reglages)
    if (lignes.length === 0) continue

    donnees.push({
      cle: `email:resume:${userId}:${jourCle(resumeDu)}`.slice(0, 200),
      destinataireId: userId,
      notificationId: null,
      type: null,
      resumeDu,
      statut: 'enAttente',
      tentatives: 0,
    })
  }

  if (donnees.length === 0) return { candidats: comptes.length, crees: 0 }

  const { count } = await prisma.emailNotification.createMany({
    data: donnees,
    skipDuplicates: true,
  })
  return { candidats: comptes.length, crees: count }
}

/** Compteurs d'emails envoyés au destinataire sur 1 h et 24 h glissantes. */
async function chargerPlafonds(
  destinataireId: number,
  maintenant: Date,
): Promise<PlafondsDestinataire> {
  const [heure, jour] = await Promise.all([
    prisma.emailNotification.count({
      where: {
        destinataireId,
        statut: 'envoye',
        envoyeLe: { gte: new Date(maintenant.getTime() - HEURE_MS) },
      },
    }),
    prisma.emailNotification.count({
      where: {
        destinataireId,
        statut: 'envoye',
        envoyeLe: { gte: new Date(maintenant.getTime() - JOUR_MS) },
      },
    }),
  ])
  return { heure, jour }
}

/** Abandon PROPRE : statut terminal, plus jamais relancé. */
async function abandonner(
  id: number,
  erreur: string,
  tentatives?: number,
): Promise<void> {
  await prisma.emailNotification.update({
    where: { id },
    data: {
      statut: 'abandonne',
      erreur: erreur.slice(0, 300),
      prochaineTentative: null,
      ...(tentatives === undefined ? {} : { tentatives }),
    },
  })
}

/** Report SANS consommation de tentative (plafond, configuration, verrou). */
async function reporter(id: number, maintenant: Date, delaiMs: number): Promise<void> {
  await prisma.emailNotification.update({
    where: { id },
    data: { prochaineTentative: new Date(maintenant.getTime() + delaiMs) },
  })
}

/**
 * Draine au plus `TAILLE_LOT` lignes dues. No-op TOTAL (aucune requête, aucune
 * ligne touchée) si Resend ou `AUTH_SECRET` manque : les emails restent en
 * attente et partiront une fois la configuration fournie.
 */
export async function traiterFileEmails(maintenant: Date = new Date()): Promise<BilanFile> {
  const bilan: BilanFile = {
    configuration: false,
    examines: 0,
    envoyes: 0,
    reportes: 0,
    echecs: 0,
    abandons: 0,
  }

  // Un email sans lien de désabonnement signé serait non conforme : on
  // s'arrête AVANT de lire quoi que ce soit.
  if (!estEnvoiConfigure() || !process.env.AUTH_SECRET?.trim()) return bilan
  bilan.configuration = true

  const lignes: LigneFile[] = await prisma.emailNotification.findMany({
    where: {
      statut: 'enAttente',
      OR: [{ prochaineTentative: null }, { prochaineTentative: { lte: maintenant } }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: TAILLE_LOT,
    select: {
      id: true,
      destinataireId: true,
      notificationId: true,
      type: true,
      resumeDu: true,
      tentatives: true,
      notification: {
        select: { titre: true, contenu: true, compteur: true, type: true },
      },
      destinataire: { select: { email: true } },
    },
  })
  bilan.examines = lignes.length

  const reglagesParCompte = new Map<number, ReglagesDestinataire>()
  const plafondsParCompte = new Map<number, PlafondsDestinataire>()
  const debutDrain = Date.now()

  for (const ligne of lignes) {
    // Budget du passage : les lignes non réclamées restent dues pour le cron
    // suivant, celles déjà réclamées redeviennent dues après le verrou.
    if (Date.now() - debutDrain >= BUDGET_DRAIN_MS) break

    // Réclamation atomique : seul le premier cron obtient count = 1.
    const verrou = await prisma.emailNotification.updateMany({
      where: {
        id: ligne.id,
        statut: 'enAttente',
        OR: [{ prochaineTentative: null }, { prochaineTentative: { lte: maintenant } }],
      },
      data: { prochaineTentative: new Date(maintenant.getTime() + VERROU_MS) },
    })
    if (verrou.count !== 1) continue

    let reglages = reglagesParCompte.get(ligne.destinataireId)
    if (reglages === undefined) {
      reglages = await chargerReglages(ligne.destinataireId)
      reglagesParCompte.set(ligne.destinataireId, reglages)
    }

    if (!emailAutorise(reglages, ligne.type)) {
      await abandonner(ligne.id, 'desactive')
      bilan.abandons += 1
      continue
    }

    const destinataire = ligne.destinataire.email?.trim()
    if (!destinataire) {
      await abandonner(ligne.id, 'destinataire_sans_email')
      bilan.abandons += 1
      continue
    }

    let plafonds = plafondsParCompte.get(ligne.destinataireId)
    if (plafonds === undefined) {
      plafonds = await chargerPlafonds(ligne.destinataireId, maintenant)
      plafondsParCompte.set(ligne.destinataireId, plafonds)
    }
    if (plafonds.jour >= PLAFOND_JOUR) {
      await reporter(ligne.id, maintenant, JOUR_MS)
      bilan.reportes += 1
      continue
    }
    if (plafonds.heure >= PLAFOND_HEURE) {
      await reporter(ligne.id, maintenant, HEURE_MS)
      bilan.reportes += 1
      continue
    }

    const liens = liensEmail(ligne.destinataireId, maintenant)
    if (liens === null) {
      // Rotation de secret entre le contrôle d'entrée et cette ligne : on
      // reporte sans consommer de tentative.
      await reporter(ligne.id, maintenant, HEURE_MS)
      bilan.reportes += 1
      continue
    }

    let email: EmailConstruit
    if (ligne.notificationId !== null) {
      if (ligne.notification === null) {
        await abandonner(ligne.id, 'notification_absente')
        bilan.abandons += 1
        continue
      }
      email = construireEmailNotificationRendue(ligne.notification, liens)
    } else if (ligne.resumeDu !== null) {
      if (maintenant.getTime() - ligne.resumeDu.getTime() > PEREMPTION_RESUME_MS) {
        await abandonner(ligne.id, 'resume_perime')
        bilan.abandons += 1
        continue
      }
      const lignesDuResume = await lignesResume(ligne.destinataireId, ligne.resumeDu, reglages)
      if (lignesDuResume.length === 0) {
        await abandonner(ligne.id, 'resume_vide')
        bilan.abandons += 1
        continue
      }
      email = construireEmailResumeQuotidien(lignesDuResume, liens)
    } else {
      await abandonner(ligne.id, 'ligne_invalide')
      bilan.abandons += 1
      continue
    }

    const resultat = await envoyerEmail({ destinataire, email })

    if (resultat.ok) {
      await prisma.emailNotification.update({
        where: { id: ligne.id },
        data: {
          statut: 'envoye',
          envoyeLe: maintenant,
          tentatives: { increment: 1 },
          erreur: null,
          prochaineTentative: null,
        },
      })
      plafonds.heure += 1
      plafonds.jour += 1
      bilan.envoyes += 1
      continue
    }

    const tentatives = ligne.tentatives + 1
    if (tentatives >= MAX_TENTATIVES) {
      await abandonner(ligne.id, resultat.erreur, tentatives)
      bilan.abandons += 1
    } else {
      await prisma.emailNotification.update({
        where: { id: ligne.id },
        data: {
          tentatives,
          erreur: resultat.erreur.slice(0, 300),
          prochaineTentative: new Date(
            maintenant.getTime() + DELAI_REPRISE_BASE_MS * 4 ** (tentatives - 1),
          ),
        },
      })
      bilan.echecs += 1
    }
  }

  return bilan
}
