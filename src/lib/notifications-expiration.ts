import 'server-only'

import { dateCouranteDouala, minuitDouala } from '@/lib/douala'
import {
  cleNotification,
  emettreNotification,
} from '@/lib/notifications-emission'
import { prisma } from '@/lib/prisma'

// ─── Notification des offres expirées (M9, correctif Vague 3) ───────────────
//
// ANOMALIE CORRIGÉE : dans M6/M7, l'expiration n'est PAS un événement — elle
// est dérivée à chaque lecture (`dateExpiration < minuitDouala(aujourd'hui)`,
// voir offres-public.ts et douala.ts). Aucune action n'écrit donc
// `offreIndisponible` quand une offre expire naturellement, alors que les
// candidats concernés doivent être prévenus comme lors d'une clôture, d'une
// suppression ou d'une suspension.
//
// CE MODULE NE MODIFIE PAS M6/M7 : il lit les offres publiées devenues
// invisibles et leurs candidatures, puis émet la notification M9 EXISTANTE
// `offreIndisponible` (mêmes textes, même lien, même outbox). C'est une
// tâche planifiée M9, appelée par GET /api/cron/notifications — pas un hook
// métier et pas une action.
//
// FRONTIÈRE DE DATE : identique au prédicat de visibilité. Une offre dont
// `dateExpiration` vaut le jour courant (Douala) reste visible toute la
// journée ; elle n'entre dans le scan qu'au minuit civil suivant, quand
// `dateExpiration < seuil`.
//
// IDEMPOTENCE : une notification n'est émise que si sa clé
// `offreIndisponible:<offreId>:<userId>` n'existe pas déjà. Un second
// passage du cron ne crée donc rien. La fenêtre de rattrapage de 7 jours
// borne le scan : elle rattrape une panne de planificateur, sans recréer
// indéfiniment une notification que l'utilisateur a supprimée ou que le
// cycle de purge a effacée (purge à 90 jours).
//
// PÉRIMÈTRE : offres `publiee`, non supprimées logiquement, ayant au moins
// une candidature. Les offres clôturées, suspendues ou supprimées ont déjà
// déclenché le hook au moment de leur transition. Un candidat reçoit UNE
// notification par offre, même si la contrainte (offre, candidat) rend les
// doublons impossibles.
//
// JAMAIS BLOQUANT : `emettreNotification` ne lève jamais ; un échec unitaire
// n'interrompt pas le lot. Une erreur de LECTURE remonte au cron, qui la
// réduit au code `expirations` sans exposer de donnée personnelle.
// ---------------------------------------------------------------------------

/** Fenêtre de rattrapage : offres expirées depuis au plus 7 jours. */
export const FENETRE_RATTRAPAGE_JOURS = 7

const JOUR_MS = 24 * 60 * 60 * 1000

/** Compteurs du passage (aucune PII) — repris tel quel par le cron. */
export interface BilanExpirations {
  /** Offres expirées examinées (avec au moins une candidature). */
  offres: number
  /** Notifications réellement créées lors de ce passage. */
  notifications: number
}

/**
 * Notifie les candidats des offres publiées expirées depuis peu. Idempotent
 * par clé de notification ; ne lève que sur erreur de lecture base.
 */
export async function notifierOffresExpirees(
  maintenant: Date = new Date(),
): Promise<BilanExpirations> {
  const seuil = minuitDouala(dateCouranteDouala(maintenant))
  const debutFenetre = new Date(
    seuil.getTime() - FENETRE_RATTRAPAGE_JOURS * JOUR_MS,
  )

  const offres = await prisma.offre.findMany({
    where: {
      statut: 'publiee',
      deletedAt: null,
      dateExpiration: { lt: seuil, gte: debutFenetre },
      candidatures: { some: {} },
    },
    select: { id: true, titre: true },
    orderBy: { id: 'asc' },
  })

  if (offres.length === 0) {
    return { offres: 0, notifications: 0 }
  }

  const titres = new Map(offres.map((offre) => [offre.id, offre.titre]))
  const candidatures = await prisma.candidature.findMany({
    where: { offreId: { in: offres.map((offre) => offre.id) } },
    // `candidature.candidatId` est un Candidat.id : la notification vise le
    // COMPTE (`candidat.userId`), comme le résolveur offreIndisponible.
    select: {
      offreId: true,
      candidat: { select: { userId: true } },
    },
    orderBy: [{ offreId: 'asc' }, { candidatId: 'asc' }],
  })

  const cles = candidatures.map(({ offreId, candidat }) =>
    cleNotification('offreIndisponible', offreId, candidat.userId),
  )

  // Lecture en une requête : évite une vérification par candidat (N+1).
  const existantes =
    cles.length === 0
      ? []
      : await prisma.notification.findMany({
          where: { cle: { in: cles } },
          select: { cle: true },
        })
  const dejaNotifies = new Set(existantes.map((notification) => notification.cle))

  let notifications = 0

  for (const { offreId, candidat } of candidatures) {
    const titre = titres.get(offreId)
    if (titre === undefined) continue

    const destinataireId = candidat.userId
    const cle = cleNotification('offreIndisponible', offreId, destinataireId)
    if (dejaNotifies.has(cle)) continue

    const resultat = await emettreNotification({
      destinataireId,
      type: 'offreIndisponible',
      refId: offreId,
      lien: '/candidat/candidatures',
      variables: { type: 'offreIndisponible', titreOffre: titre },
    })
    if (resultat !== null) notifications += 1
  }

  return { offres: offres.length, notifications }
}
