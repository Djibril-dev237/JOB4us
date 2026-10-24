'use server'

import { Prisma } from '@prisma/client'
import { notFound } from 'next/navigation'

import { verifySession } from '@/lib/dal'
import {
  curseurDepuisPayload,
  listerNotifications,
  marquerLue,
  marquerToutLue,
  supprimerNotification as supprimerLigneNotification,
  type PageNotifications,
} from '@/lib/notifications-dal'
import { TYPES_NON_DESACTIVABLES } from '@/lib/notifications-labels'
import {
  schemaCurseurNotifications,
  schemaMarquerNotificationLu,
  schemaPreferenceEmailType,
  schemaReglageResumeQuotidien,
  schemaSupprimerNotification,
  schemaToutMarquerLu,
} from '@/lib/notifications-schemas'
import { prisma } from '@/lib/prisma'

// ─── Actions serveur des NOTIFICATIONS (M9, Vague 2) ─────────────────────────
//
// Contrats repris AU MOT de src/app/actions/messagerie.ts (M8) et
// src/app/actions/admin-messagerie.ts (M8, Vague 3) :
//
// * SESSION : `verifySession` (src/lib/dal.ts) — la cloche du header ET ces
//   deux pages sont ouvertes à TOUS les rôles authentifiés (candidat,
//   recruteur, admin), donc JAMAIS `verifyRole('candidat','recruteur')`. Un
//   non-connecté garde le redirect /login du DAL (commun à toutes les
//   actions du dépôt).
//
// * FORME D'ABORD (Zod `.strict()` des schémas de notifications-schemas.ts,
//   source UNIQUE — aucun schéma recopié ici) : une clé forgée
//   (`destinataireId`, `userId`, `lu`, `emailActive` en chaîne…) fait
//   ÉCHOUER le parse → verdict net, AUCUNE lecture ni écriture.
//
// * PUIS AUTORISATION : la destination sort TOUJOURS de la session, jamais du
//   payload ; le DAL porte l'appartenance dans le `where` MÊME de
//   l'écriture. Un id d'autrui → `false` → `notFound()` : 404
//   INDISCERNABLE d'un id inexistant, jamais de 403 ni de verdict
//   différencié (doctrine M6/M7 reconduite).
//
// * JAMAIS d'exception brute ne sort d'une action : chaque écriture est
//   entourée d'un catch qui rend un verdict net (`{ ok: false }`, `null`,
//   `0`…), seul `notFound()` (contrôle) peut lever. Les logs ne portent que
//   des POINTEURS (id) et le code Prisma — jamais de donnée personnelle.
//
// * Aucun redirect : ces actions rendent une donnée consommable par le
//   client (sauf le `notFound()` de contrôle ci-dessus).
//
// * RÈGLE MÉTIER `desactivable` (METADONNEES / TYPES_NON_DESACTIVABLES) :
//   les schémas ne jugent QUE la forme, la règle est croisée ICI, AVANT
//   toute écriture (injonction documentée dans notifications-schemas.ts §5).
//
// * PRÉFÉRENCES : la ligne ABSENTE vaut `preferencesParDefaut()[type]`
//   (notifications-labels) — `schemaPreferenceEmailType` porte la CIBLE
//   effective (`emailActive`) que le client calcule depuis cet état, donc
//   l'action ÉCRIT la valeur reçue par upsert, sans seconde lecture (une
//   lecture ne servirait qu'à re-vérifier ce que le parse a déjà tranché).
// ---------------------------------------------------------------------------

/** Verdict d'une action : aucun texte n'est fabriqué ici (TEXTES côté écran). */
export type ResultatNotification = { ok: true } | { ok: false; erreur: 'inconnue' }

/** Code Prisma utile au diagnostic ; ailleurs un libellé neutre. */
function codeErreur(erreur: unknown): string {
  return erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
}

/**
 * Page de notifications plus anciennes (« Charger plus »), pour le COMPTE DE
 * LA SESSION — le curseur vient du client mais ne DOIT cibler que ses lignes :
 * `userId` sort de la session, jamais du payload (le schema ne porte d'ailleurs
 * aucun identifiant d'utilisateur, `.strict()` le refuse s'il est injecté).
 *
 * Retourne `null` en cas de payload hors contrat ou d'échec DB (lecture
 * best-effort) : aucun verdict différencié, le bouton affiche
 * `TEXTES.erreurChargement` + `TEXTES.boutonReessayer` côté client.
 */
export async function chargerNotifications(payload: unknown): Promise<PageNotifications | null> {
  const session = await verifySession()

  const parse = schemaCurseurNotifications.safeParse(payload)
  if (!parse.success) {
    return null
  }

  try {
    // Pont payload → curseur DAL (conversion TOTALE, `undefined` jamais transmis).
    return await listerNotifications(session.userId, curseurDepuisPayload(parse.data))
  } catch {
    // Best-effort : le bouton « Charger plus » ne doit jamais recevoir de
    // Stack Trace Prisma, et aucun log ne peut contenir de donnée ici.
    return null
  }
}

/**
 * Marque une notification COMME LUE.
 *
 * `false` du DAL = inexistante OU d'autrui OU déjà lue : les trois partagent
 * le MÊME `notFound()` (404 indiscernable, aucun oracle d'énumération). Le
 * `notFound()` est posé HORS du try : il ne doit jamais être avalé par le
 * catch d'échec DB.
 */
export async function marquerNotificationLu(payload: unknown): Promise<ResultatNotification> {
  const session = await verifySession()

  const parse = schemaMarquerNotificationLu.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  let lu: boolean
  try {
    lu = await marquerLue(parse.data.notificationId, session.userId)
  } catch (erreur) {
    console.error('[notifications] marquer-lu', {
      notificationId: parse.data.notificationId,
      code: codeErreur(erreur),
    })
    return { ok: false, erreur: 'inconnue' }
  }

  if (!lu) {
    notFound()
  }
  return { ok: true }
}

/**
 * « Tout marquer comme lu » — le périmètre (TOUTES les non lues du COMPTE)
 * sort de la session, le payload est un objet VIDE `.strict()` : aucune cible
 * ni aucun filtre ne peut être glissé dans cette action.
 *
 * Retourne le nombre de notifications marquées, ou `null` en cas d'échec
 * (verdict net côté client : aucun état local n'est basculé, `TEXTES.actionEchouee`).
 */
export async function toutMarquerLu(): Promise<number | null> {
  const session = await verifySession()

  const parse = schemaToutMarquerLu.safeParse({})
  if (!parse.success) {
    return null
  }

  try {
    return await marquerToutLue(session.userId)
  } catch (erreur) {
    console.error('[notifications] tout-lu', { userId: session.userId, code: codeErreur(erreur) })
    return null
  }
}

/**
 * Supprime DEFINITIVEMENT une notification du compte — même doctrine que le
 * marquage : `false` (inexistante OU d'autrui) → `notFound()`, jamais de 403.
 * Schema DISTINCT de `schemaMarquerNotificationLu` : deux effets différents,
 * jamais de dérive par « réutilisation » du même schéma.
 */
export async function supprimerNotification(payload: unknown): Promise<ResultatNotification> {
  const session = await verifySession()

  const parse = schemaSupprimerNotification.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  let supprime: boolean
  try {
    supprime = await supprimerLigneNotification(parse.data.notificationId, session.userId)
  } catch (erreur) {
    console.error('[notifications] supprimer', {
      notificationId: parse.data.notificationId,
      code: codeErreur(erreur),
    })
    return { ok: false, erreur: 'inconnue' }
  }

  if (!supprime) {
    notFound()
  }
  return { ok: true }
}

/**
 * Écrit la préférence email d'un type : `schemaPreferenceEmailType` porte la
 * CIBLE (`emailActive`), l'action la transpose telle quelle dans un upsert
 * sur l'unique `[userId, type]` — 1 requête, aucun insert en double possible.
 *
 * La ligne absente vaut `preferencesParDefaut()[type]` : le client calcule la
 * cible depuis l'état effectif transmis par la page, donc écrire l'inverse du
 * défaut (ligne absente) ou l'inverse de la ligne (ligne présente) revient à
 * écrire `emailActive` tel que reçu — AUCUNE seconde lecture n'est nécessaire.
 *
 * Contrôle métier AVANT écriture : un type NON désactivable (`signalementRecu`,
 * devoir de modération — notifications-schemas §5) est refusé, sans ligne
 * possible pour ce type.
 */
export async function basculerPreferenceEmail(payload: unknown): Promise<ResultatNotification> {
  const session = await verifySession()

  const parse = schemaPreferenceEmailType.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  if (TYPES_NON_DESACTIVABLES.includes(parse.data.type)) {
    return { ok: false, erreur: 'inconnue' }
  }

  try {
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: session.userId, type: parse.data.type } },
      create: {
        userId: session.userId,
        type: parse.data.type,
        emailActive: parse.data.emailActive,
      },
      update: { emailActive: parse.data.emailActive },
    })
    return { ok: true }
  } catch (erreur) {
    console.error('[notifications] preference-email', {
      type: parse.data.type,
      code: codeErreur(erreur),
    })
    return { ok: false, erreur: 'inconnue' }
  }
}

/**
 * Écrit le réglage du résumé quotidien : upsert sur la clé `userId` de
 * `NotificationReglage` (ligne absente = défaut du modèle, `resumeQuotidien`
 * false). Booléen STRICT : `"true"` (FormData, payload forgé) est refusé avant
 * toute écriture.
 */
export async function enregistrerResumeQuotidien(
  payload: unknown,
): Promise<ResultatNotification> {
  const session = await verifySession()

  const parse = schemaReglageResumeQuotidien.safeParse(payload)
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  try {
    await prisma.notificationReglage.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, resumeQuotidien: parse.data.resumeQuotidien },
      update: { resumeQuotidien: parse.data.resumeQuotidien },
    })
    return { ok: true }
  } catch (erreur) {
    console.error('[notifications] resume-quotidien', { code: codeErreur(erreur) })
    return { ok: false, erreur: 'inconnue' }
  }
}
