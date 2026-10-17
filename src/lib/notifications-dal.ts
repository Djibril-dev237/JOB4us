import 'server-only'

import { prisma } from '@/lib/prisma'
import type { CurseurNotifications } from '@/lib/notifications-schemas'
import type { TypeNotification } from '@/lib/notifications-labels'

// ─── Couche d'accès aux données des NOTIFICATIONS (M9, Vague 1) ─────────────
//
// Contrat central : une notification appartient à UN utilisateur et porte
// une clé d'idempotence `cle` (émise par la Vague suivante, jamais par ce
// module). Ce DAL ne fait QUE lire, marquer, supprimer, archiver et purger
// des lignes `Notification` — l'écriture de NOUVELLES notifications
// (upsert par `cle`, décompte `compteur`, emails) appartient au module
// d'émission de la Vague 2. Aucune écriture hors du modèle `Notification`.
//
// SÉCURITÉ — 404 indiscernable (calque de messagerie-dal) : toute
// opération ciblée par id (`marquerLue`, `supprimerNotification`) porte
// l'AUTHORISATION dans le `where` MÊME de l'écriture (`id` + `userId`).
// Un id d'autrui produit count 0, strictement identique à un id inexistant :
// jamais de 403, jamais de message différencié — distinguer reviendrait à
// révéler l'existence des notifications d'autrui. C'est l'appelant
// (server action de la Vague 2) qui pose `userId` = session.
//
// ANTI-RÉGRESSION — `lueLe` ne régresse JAMAIS : marquer une notification
// déjà lue ne réécrit pas son horodatage de lecture. L'arbitrage (documenté
// sur `marquerLue`) porte la garde `isLu: false` dans le `where` plutôt
// qu'une condition de progressivité sur `lueLe` : une écriture zéro-utile
// est un UPDATE qu'on évite, et le verdict « rien à faire » est absorbé.
//
// PERF — aucun N+1 : chaque fonction émet un nombre de requêtes FIXE et
// borné (1 seule pour chacune d'elles). La cloche M2 (`compterNonLues`)
// repose sur l'index `notifications_user_lu_idx`, la liste paginée sur
// `notifications_user_created_idx`, l'archivage sur
// `notifications_archivage_idx` et la purge sur `notifications_purge_idx`.
//
// CYCLE DE VIE — non archivée (`archiveeLe` null) = visible dans la liste ;
// archivée par le cron à 30 jours après lecture ; purgée définitivement
// 90 jours après archivage. Les deux crons (`archiverLuees`,
// `purgerArchivees`) n'emportent AUCUN userId : ce sont des tâches
// globales, leur where porte les seuils seuls.
//
// Ce module alimente la page /notifications, la cloche du header et les
// server actions de la Vague 2 — jamais un composant client directement.
// ---------------------------------------------------------------------------

/** Taille d'une page de notifications (constante EXPORTÉE : pagination testable). */
export const PAGE_NOTIFICATIONS = 20

/** Délai d'archivage après lecture, en jours (cron, index `notifications_archivage_idx`). */
export const DELAI_ARCHIVAGE_JOURS = 30

/** Délai de purge après archivage, en jours (cron, index `notifications_purge_idx`). */
export const DELAI_PURGE_JOURS = 90

// ─── Contrats de retour (API figée — les vagues suivantes codent dessus) ────

/** Une ligne de la cloche/liste : champs d'affichage bruts, aucun texte interprété. */
export interface LigneNotification {
  id: number
  type: TypeNotification
  titre: string
  contenu: string | null
  lien: string | null
  isLu: boolean
  compteur: number
  createdAt: Date
}

export interface PageNotifications {
  notifications: LigneNotification[]
  /** true si une page PLUS ANCIENNE existe (il reste à descendre). */
  aPlusAncien: boolean
}

/**
 * PONT payload Zod → curseur DAL : la tuple validée `[createdAt ISO, id]`
 * (schéma `schemaCurseurNotifications`, import TYPE uniquement — aucun cycle
 * runtime) devient la forme consommée par `listerNotifications`. L'ABSENCE de
 * curseur vaut premier chargement (`null`) : la conversion est TOTALE, aucun
 * `undefined` ne franchit cette frontière. Aucune re-validation ici — le
 * parse Zod a déjà refusé toute forme hors contrat, donc `new Date(iso)` est
 * sûr par construction (`datetime({ offset: true })` garantit un ISO
 * consommable). Sans ce pont, chaque appelant convertirait à l'aveugle et la
 * forme du curseur divergerait entre le schema et le DAL sans test pour le
 * dire.
 */
export function curseurDepuisPayload(
  payload: CurseurNotifications,
): { createdAt: Date; id: number } | null {
  if (payload.curseur === undefined) return null
  const [createdAt, id] = payload.curseur
  return { createdAt: new Date(createdAt), id }
}

// ─── Liste paginée par curseur composite [createdAt, id] ────────────────────

/**
 * Notifications NON archivées d'un compte, plus récentes d'abord, en
 * pagination par curseur COMPOSITE `[createdAt, id]` — UNE requête fixe,
 * aucun N+1, la relation `user` n'est PAS chargée (l'appelant connaît déjà
 * l'utilisateur : la jointure ne ferait que transférer inutilement).
 *
 * Le curseur porte deux colonnes car `createdAt` n'est PAS unique (deux
 * notifications peuvent être émises à la même milliseconde — upsert groupé) :
 * une condition sur `createdAt` seul sauterait ou dupliquerait des lignes à
 * la jonction des pages. La seconde branche (`createdAt = curseur ET id
 * strictement plus petit`) ancre la reprise sur la ligne exacte déjà
 * rendue. STRICTETÉ partout : `lt` jamais `lte` — le dernier élément rendu
 * ne réapparaît jamais en tête de la page suivante.
 *
 * `take: PAGE_NOTIFICATIONS + 1` : la 21e ligne n'existe QUE pour prouver
 * l'existence d'une page suivante (`aPlusAncien`), la page est tronquée à
 * `PAGE_NOTIFICATIONS` avant d'être rendue. Tri `[createdAt, id] DESC`
 * aligné sur le curseur (index `notifications_user_created_idx` en tête de
 * colonne, pas de filesort).
 */
export async function listerNotifications(
  userId: number,
  curseur: { createdAt: Date; id: number } | null,
): Promise<PageNotifications> {
  const bruts = await prisma.notification.findMany({
    where: {
      userId,
      // Archivées invisibles dans la liste : seul le cron les a déplacées.
      archiveeLe: null,
      ...(curseur === null
        ? {}
        : {
            // Curseur composite STRICT : soit plus ancien que le curseur,
            // soit au même instant mais avec un id plus petit.
            OR: [
              { createdAt: { lt: curseur.createdAt } },
              { createdAt: curseur.createdAt, id: { lt: curseur.id } },
            ],
          }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_NOTIFICATIONS + 1,
    select: {
      id: true,
      type: true,
      titre: true,
      contenu: true,
      lien: true,
      isLu: true,
      compteur: true,
      createdAt: true,
    },
  })

  const aPlusAncien = bruts.length > PAGE_NOTIFICATIONS

  return {
    notifications: bruts.slice(0, PAGE_NOTIFICATIONS).map((notification) => ({
      id: notification.id,
      type: notification.type,
      titre: notification.titre,
      contenu: notification.contenu,
      lien: notification.lien,
      isLu: notification.isLu,
      compteur: notification.compteur,
      createdAt: notification.createdAt,
    })),
    aPlusAncien,
  }
}

// ─── Compteur de la cloche (header M2) ──────────────────────────────────────

/**
 * Nombre de notifications non lues et non archivées d'un compte — le
 * compteur de la cloche du header. 1 requête `count`, portée par l'index
 * `notifications_user_lu_idx` (`userId, isLu`) : pas de transfert de
 * lignes, pas de comptage en mémoire. Archivées exclues par cohérence avec
 * `listerNotifications` : une notification archivée n'est plus « à lire ».
 */
export async function compterNonLues(userId: number): Promise<number> {
  return prisma.notification.count({
    where: { userId, isLu: false, archiveeLe: null },
  })
}

// ─── Accusé de lecture ──────────────────────────────────────────────────────

/**
 * Marque une notification COMME LUE — 1 requête `updateMany`, l'
 * AUTORISATION vit dans le `where` de l'écriture elle-même : `{ id,
 * userId, ... }`, jamais une lecture puis une seconde vérification (qui
 * laisserait une fenêtre de course TOCTOU et exposerait deux chemins
 * d'erreur). Un id d'autrui → count 0, verdict INDISCERNABLE d'un id
 * inexistant (404 global côté appelant, jamais de 403).
 *
 * ARBITRAGE anti-régression de `lueLe` : le `where` porte `isLu: false`
 * (plutôt qu'une clause de progressivité `lueLe: null OU lueLe < …`). Une
 * notification DÉJÀ lue échoue donc le CAS et conserve sa date de lecture
 * d'origine — `lueLe` ne régresse jamais. Conséquence assumée et voulue :
 * count 0 signifie aussi « déjà lu » (rien à faire), verdict délibérément
 * identique à « inexistante » ou « d'autrui » — une écriture zéro-utile
 * est un UPDATE qu'on évite, et aucun oracle n'est ouvert. `archiveeLe:
 * null` complète la garde : une notification archivée n'est plus
 * « marquable » (son cycle de vie est terminé côté lecture).
 *
 * `true` = la notification vient d'être lue ; `false` = rien à faire.
 */
export async function marquerLue(notificationId: number, userId: number): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, isLu: false, archiveeLe: null },
    data: { isLu: true, lueLe: new Date() },
  })

  return count > 0
}

/**
 * « Tout marquer comme lu » — 1 requête `updateMany` d'UN SEUL tenant :
 * toutes les non lues et non archivées D'UN compte (le `userId` est la
 * clause d'autorisation ET de ciblage — jamais un where sans userId qui
 * traverserait les comptes). Retourne le nombre de notifications marquées
 * (0 = rien à faire, pas d'erreur). `lueLe` est posé au moment de
 * l'appel : la progressivité est ici sans objet (le where ne vise que
 * des `isLu: false`), et une seconde exécution n'atteint plus aucune ligne.
 */
export async function marquerToutLue(userId: number): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, isLu: false, archiveeLe: null },
    data: { isLu: true, lueLe: new Date() },
  })

  return count
}

// ─── Suppression par l'utilisateur ──────────────────────────────────────────

/**
 * Supprime DEFINITIVEMENT une notification — 1 requête `deleteMany`, avec
 * l'AUTORISATION portée par le `where` (`{ id, userId }`) : aucun
 * deleteUnique, aucun contrôle après coup. Un id d'autrui → count 0,
 * verdict strictement identique à un id inexistant (404 global, jamais de
 * 403). `true` = supprimée ; `false` = rien à faire (inexistante, d'autrui
 * — jamais lequel).
 */
export async function supprimerNotification(
  notificationId: number,
  userId: number,
): Promise<boolean> {
  const { count } = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  })

  return count > 0
}

// ─── Entretien (crons globaux) ──────────────────────────────────────────────

/**
 * Cron d'ARCHIVAGE — 1 requête `updateMany` globale (aucun userId : la
 * tâche ne parcourt pas les comptes). Archive toute notification lue
 * (`isLu: true`) dont la lecture date de plus de `DELAI_ARCHIVAGE_JOURS`
 * jours (`lueLe < seuil`) et qui n'est pas déjà archivée — le where suit
 * l'index `notifications_archivage_idx` (`isLu, lueLe`). `archiveeLe` est
 * posé au moment de l'exécution (pas à `lueLe` : l'archivage est un fait
 * du cron, pas de la lecture). Idempotent : une seconde exécution n'atteint
 * plus aucune ligne (`archiveeLe: null` dans le where). Retourne le nombre
 * de notifications archivées.
 */
export async function archiverLuees(): Promise<number> {
  const seuil = new Date(Date.now() - DELAI_ARCHIVAGE_JOURS * 24 * 60 * 60 * 1000)

  const { count } = await prisma.notification.updateMany({
    where: { isLu: true, archiveeLe: null, lueLe: { lt: seuil } },
    data: { archiveeLe: new Date() },
  })

  return count
}

/**
 * Cron de PURGE — 1 requête `deleteMany` globale : suppression DEFINITIVE
 * de toute notification archivée depuis plus de `DELAI_PURGE_JOURS` jours
 * (`archiveeLe < seuil`, index `notifications_purge_idx`). La purge ne
 * regarde NI `isLu` NI `userId` : l'archivage garantit déjà que seules des
 * notifications lues arrivent ici. Idempotent (les lignes purgées
 * n'existent plus). Retourne le nombre de notifications purgées.
 */
export async function purgerArchivees(): Promise<number> {
  const seuil = new Date(Date.now() - DELAI_PURGE_JOURS * 24 * 60 * 60 * 1000)

  const { count } = await prisma.notification.deleteMany({
    where: { archiveeLe: { lt: seuil } },
  })

  return count
}
