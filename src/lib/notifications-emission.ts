import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  METADONNEES,
  emailActif,
  texteNotification,
  type TypeNotification,
  type VariablesNotification,
} from '@/lib/notifications-labels'
import { estLienInterne } from '@/lib/notifications-liens'

// ─── Cœur d'émission des notifications (M9, Vague 2) ────────────────────────
//
// SEUL endroit du projet qui écrit de NOUVELLES lignes `Notification`
// (auth.ts est le seul autre site, parité M4, déjà traité au commit Vague 1
// schema) et SEUL endroit qui empile dans l'outbox `EmailNotification`.
// Il est appelé PAR les branches d'événements M7/M8 (evenements-*.ts), jamais
// par une action métier directement, jamais par un composant.
//
// IDEMPOTENCE (critère de module) — la `cle` est DÉTERMINISTE et ne porte
// AUCUN temps : `type:ref:destinataire`, où `refId` est l'identifiant de la
// SOURCE MÈRE de l'événement (conversationId, candidatureId, offreId, couple
// inscription/admin…). Conséquences :
//  * un événement REJOUÉ (double branche, retry, double clic, rejeu partiel)
//    recalcule la MÊME clé → l'upsert incrémente `compteur` au lieu de
//    dupliquer → rejeu = TOUJOURS une seule notification groupée ;
//  * le regroupement (« 3 nouveaux messages ») est une conséquence de
//    l'idempotence, pas une logique parallèle : UNE table, UN cycle de vie,
//    UNE ligne par source et par destinataire, quel que soit le nombre
//    d'événements.
// Le destinataire fait PARTIE de la clé : les événements multi-destinataires
// (`offreIndisponible` vers chaque candidat, `offrePubliee` et
// `signalementRecu` vers chaque admin) produisent une ligne PAR destinataire.
// Sans lui, la contrainte globale sur `cle` ferait converger tous les
// destinataires vers la ligne du premier (bug corrigé en Vague 3).
// Chaque branche émettrice garantit l'unicité du couple (type, refId) pour
// un même destinataire (ex. `systeme:inscription:{userId}:{adminId}`
// dans auth.ts : une inscription = une notification PAR admin).
//
// JAMAIS BLOQUANT (critère de module) — ce module ne LÈVE JAMAIS : tout
// échec DB (réseau, FK, contrainte) est AVALÉ et tracé en `console.error`
// hors production. Les actions M5/M7/M8 ne voient JAMAIS leur verdict
// retourné par une notification. L'outbox est DURABLE : un email n'est
// jamais envoyé en ligne d'action, il est empilé en `enAttente` puis drainé
// par notifications-outbox.ts (Vague 3).
//
// PRÉFÉRENCES — l'absence de ligne vaut le défaut du code
// (`preferencesParDefaut()`, jamais de seed). Un email n'est empilé QUE si
// la préférence effective l'autorise (défaut du catalogue, écart éventuel,
// kill switch). Le kill switch `NotificationReglage.emailsActives = false`
// coupe TOUS les emails sauf les types non-désactivables (`signalementRecu` :
// devoir de modération). La cloche in-app n'est JAMAIS filtrée par une
// préférence email : in-app et email sont deux canaux indépendants.
// ---------------------------------------------------------------------------

export interface EmissionNotification {
  /** Compte destinataire (session de l'émetteur ou cible déduite par la branche). */
  destinataireId: number
  type: TypeNotification
  /** Identifiant de la SOURCE MÈRE : la clé d'idempotence en dérive, sans temps. */
  refId: number
  /**
   * Lien in-app cible (relatif, construit par la branche émettrice). Toute
   * valeur non interne (`javascript:`, `//`, antislash, contrôle…) est
   * stockée `null` — défense en profondeur, jamais une erreur d'émission.
   */
  lien: string
  /** Variables FERMÉES de la fabrique — jamais un champ libre de la base. */
  variables: VariablesNotification
}

/** Résultat factuel d'une émission (aucune décision métier n'en dépend). */
export interface ResultatEmission {
  notificationId: number
}

/**
 * Émet UNE notification in-app (idempotente par `type:ref:destinataire`) et,
 * si les préférences l'autorisent, empile un email dans l'outbox. NE LÈVE
 * JAMAIS : un échec est avalé, tracé hors prod, et `null` est rendu.
 */
export async function emettreNotification(
  emission: EmissionNotification,
): Promise<ResultatEmission | null> {
  try {
    const { destinataireId, type, refId, lien, variables } = emission
    const { titre, contenu } = texteNotification(variables)
    const cle = cleNotification(type, refId, destinataireId)
    // Défense en profondeur : jamais de schéma exécutable ni de sortie de
    // site dans un lien stocké (rendu en <Link> et repris dans les emails).
    const lienSur = estLienInterne(lien) ? lien : null

    // Upsert idempotent : la course entre deux émetteurs simultanés se règle
    // PAR la base (contrainte unique sur `cle`), pas par un verrou
    // applicatif — le second créateur tombe sur l'upsert et incrémente.
    const notification = await prisma.notification.upsert({
      where: { cle },
      create: {
        userId: destinataireId,
        type,
        cle,
        titre,
        contenu,
        lien: lienSur,
        compteur: 1,
        dernierRefId: refId,
      },
      // Regroupement : incrémente le compteur et RÉACTUALISE le texte (le
      // compteur vit dans les variables fermées de `texteNotification`), et
      // RÉVEILLE la ligne (redevient non lue, sortie d'archive) — un nouveau
      // message d'une conversation lue doit reparaître dans la cloche.
      update: {
        compteur: { increment: 1 },
        dernierRefId: refId,
        titre,
        contenu,
        lien: lienSur,
        isLu: false,
        lueLe: null,
        archiveeLe: null,
      },
      select: { id: true },
    })

    // Email séquentiel après l'in-app (son échec ne ruine jamais l'in-app).
    await empilerEmailSiRegle(emission, notification.id)

    return { notificationId: notification.id }
  } catch (erreur) {
    // Contrat no-throw : un échec d'émission ne retourne jamais l'action
    // métier appelante. Tracé silencieux en production.
    if (process.env.NODE_ENV !== 'production') {
      console.error('[notifications] échec d’emission :', erreur)
    }
    return null
  }
}

/**
 * Clé d'idempotence déterministe, SANS temps : `type:ref:destinataire`
 * tronquée à la largeur de la colonne (200) — la troncature est sûre car
 * `type` est du catalogue (court) et `refId`/`destinataireId` sont des
 * entiers. Exportée pour la tâche d'expiration, qui doit vérifier l'absence
 * de notification avant d'émettre.
 */
export function cleNotification(
  type: TypeNotification,
  refId: number,
  destinataireId: number,
): string {
  return `${type}:${refId}:${destinataireId}`.slice(0, 200)
}

/**
 * Empile un email dans l'outbox SI la préférence effective l'autorise. La
 * clé reprend la source mère de la notification : un rejeu ne pile JAMAIS un
 * second email pour la même notification. NE LÈVE JAMAIS.
 */
async function empilerEmailSiRegle(
  emission: EmissionNotification,
  notificationId: number,
): Promise<void> {
  try {
    const { destinataireId, type, refId } = emission

    if (!(await emailAutorise(destinataireId, type))) return

    // MÊME clé que la notification, préfixée : l'unicité outbox suit
    // l'unicité d'émission (un rejeu = un seul email en attente, par
    // destinataire).
    const cle = `email:${cleNotification(type, refId, destinataireId)}`.slice(
      0,
      200,
    )

    await prisma.emailNotification.upsert({
      where: { cle },
      create: {
        cle,
        destinataireId,
        notificationId,
        type,
        statut: 'enAttente',
        tentatives: 0,
      },
      // Déjà empilé (rejeu) : on ne RÉINITIALISE ni `statut` ni
      // `tentatives` — un email envoyé ou abandonné n'est jamais relancé
      // par un rejeu d'événement.
      update: {},
      select: { id: true },
    })
  } catch (erreur) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[notifications] échec d’empilement email :', erreur)
    }
  }
}

/**
 * Décision email : défaut du catalogue, écart de préférence, kill switch.
 * `signalementRecu` (et tout type non-désactivable) traverse le kill switch.
 */
async function emailAutorise(
  destinataireId: number,
  type: TypeNotification,
): Promise<boolean> {
  const [reglage, preference] = await Promise.all([
    prisma.notificationReglage.findUnique({
      where: { userId: destinataireId },
      select: { emailsActives: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: destinataireId, type } },
      select: { emailActive: true },
    }),
  ])

  // Kill switch du désabonnement 1-clic : coupe tout sauf la modération.
  if (reglage?.emailsActives === false && METADONNEES[type].desactivable) {
    return false
  }

  // Règle unique (labels) : type non désactivable toujours actif, sinon la
  // ligne explicite l'emporte sur le défaut du catalogue.
  return emailActif(type, preference?.emailActive ?? null)
}
