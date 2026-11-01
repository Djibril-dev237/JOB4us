import 'server-only'

import { LIBELLES_STATUT } from '@/lib/candidatures-labels'
import type {
  EvenementCandidature,
  EvenementStatutChange,
} from '@/lib/evenements-candidature'
import type {
  EvenementMessageEnvoye,
  EvenementSignalementRecu,
} from '@/lib/evenements-messagerie'
import type { EvenementOffre } from '@/lib/evenements-offres'
import type { DecisionSignalement } from '@/lib/moderation-labels'
import { emettreNotification } from '@/lib/notifications-emission'
import { prisma } from '@/lib/prisma'

// ─── Résolveurs d'événements → émission (M9, Vague 2) ───────────────────────
//
// Couche intermédiaire entre les POINTS DE BRANCHEMENT M7/M8 (les fonctions
// de evenements-*.ts) et le cœur d'émission idempotent. Un résolveur fait
// CE QUE LE CONTRAT D'ÉVÉNEMENT ANNONCE : il relit la base (les payloads
// ne portent que des POINTEURS — ids — jamais de ligne ni de donnée
// personnelle) et déduit les destinataires légitimes, puis délègue à
// `emettreNotification` (idempotence, préférences, outbox : tout est là).
//
// MÊME DOCTRINE que le branchement M8 (candidatureEnvoyee →
// creerConversationDepuisCandidature) : les hooks appellent ICI en
// fire-and-forget (`void ...`), jamais les actions. Conséquences :
//  * UN seul point d'appel par événement, quels que soient les sites
//    métier qui déclenchent (3 pour offreIndisponible dont un dans
//    offres-admin.ts intouché) ;
//  * les actions M5/M7/M8 restent strictement identiques (aucune
//    modification de leur fichier) ;
//  * le verdict d'une action ne peut pas dépendre d'une notification.
//
// JAMAIS BLOQUANT : chaque résolveur avale TOUTE erreur (lecture base
// comprise) et trace hors production. Fire-and-forget au sens strict —
// un raté laisse la notification absente, écart assumé et documenté,
// identique à la doctrine M8.
//
// ARBITRAGES de la Vague 2 (couverture des 9 types) :
//  * `candidatureRecue` émise depuis `candidatureEnvoyee` (et NON depuis
//    `conversationCreee`) : « un candidat a postulé » est vrai même si la
//    création de conversation échoue — lier la notification recruteur au
//    succès de la messagerie serait un couplage fautif ;
//  * `conversationCreee` et `messageLu` restent no-op : le recruteur est
//    prévenu par `candidatureRecue`, chaque message par `messageEnvoye`,
//    et un acquittement de lecture n'est pas une notification (bruit) ;
//  * `entrepriseCertifiee` n'a AUCUN émetteur dans le code M4-M8 (anomalie
//    portée au compte-rendu, pas de bricolage) ; `systeme` est émis par
//    auth.ts (parité M4) hors de ce module.
// ---------------------------------------------------------------------------

/**
 * Garde anti auto-notification : un recruteur postulant à sa propre offre
 * (participants dérivés de la candidature, messagerie-dal) ne doit pas se
 * notifier lui-même. `destinataireId === emetteurId` → rien.
 */
function destinataireValide(
  destinataireId: number,
  emetteurId: number,
): boolean {
  return destinataireId !== emetteurId
}

/**
 * `candidatureEnvoyee` → notification « Nouvelle candidature » au RECRUTEUR
 * (propriétaire courant de l'offre : userId via entreprise, jamais copié).
 * `refId` = candidatureId : un seul postulat = une notification, rejeu
 * idempotent.
 */
export async function notifierCandidatureRecue(
  evenement: EvenementCandidature,
): Promise<void> {
  try {
    const offre = await prisma.offre.findUnique({
      where: { id: evenement.offreId },
      select: {
        titre: true,
        entreprise: { select: { userId: true } },
      },
    })
    if (offre === null) return
    await emettreNotification({
      destinataireId: offre.entreprise.userId,
      type: 'candidatureRecue',
      refId: evenement.candidatureId,
      lien: `/recruteur/candidatures/${evenement.candidatureId}`,
      variables: {
        type: 'candidatureRecue',
        titreOffre: offre.titre,
      },
    })
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `statutChange` → notification au CANDIDAT (pas à l'acteur) : c'est sa
 * candidature qui bouge. `evenement.candidatId` est un `Candidat.id` (profil),
 * pas un `User.id` : la candidature est relue pour résoudre le COMPTE
 * destinataire (`candidat.userId`) et le titre de l'offre. Libellé du statut
 * via `LIBELLES_STATUT` (source unique M7, jamais une phrase fabriquée).
 * `refId` = candidatureId : un retour en arrière puis un nouveau changement
 * regroupe sur la même ligne.
 */
export async function notifierStatutChange(
  evenement: EvenementStatutChange,
): Promise<void> {
  try {
    const candidature = await prisma.candidature.findUnique({
      where: { id: evenement.candidatureId },
      select: {
        candidat: { select: { userId: true } },
        offre: { select: { titre: true } },
      },
    })
    if (candidature === null) return
    await emettreNotification({
      destinataireId: candidature.candidat.userId,
      type: 'statutCandidature',
      refId: evenement.candidatureId,
      lien: `/candidat/candidatures/${evenement.candidatureId}`,
      variables: {
        type: 'statutCandidature',
        titreOffre: candidature.offre.titre,
        libelleStatut: LIBELLES_STATUT[evenement.nouveauStatut],
      },
    })
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `candidatureRetiree` → notification au RECRUTEUR (propriétaire courant
 * de l'offre) : le retrait est un acte du candidat, jamais de l'émetteur.
 * `refId` = candidatureId.
 */
export async function notifierCandidatureRetiree(
  evenement: EvenementCandidature,
): Promise<void> {
  try {
    const offre = await prisma.offre.findUnique({
      where: { id: evenement.offreId },
      select: {
        titre: true,
        entreprise: { select: { userId: true } },
      },
    })
    if (offre === null) return
    await emettreNotification({
      destinataireId: offre.entreprise.userId,
      type: 'candidatureRetiree',
      refId: evenement.candidatureId,
      lien: '/recruteur/candidatures',
      variables: {
        type: 'candidatureRetiree',
        titreOffre: offre.titre,
      },
    })
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `messageEnvoye` → notification « Nouveau message » à l'AUTRE participant.
 * Les participants se DÉRIVENT de la candidature (candidat postulant +
 * propriétaire courant de l'offre) — même règle que messagerie-dal, aucune
 * table de participants copiée. Auto-notification écartée (recruteur
 * postulant à sa propre offre). `refId` = conversationId : les messages
 * d'une même conversation regroupent (compteur).
 */
export async function notifierMessageEnvoye(
  evenement: EvenementMessageEnvoye,
): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: evenement.conversationId },
      select: {
        candidature: {
          select: {
            candidat: { select: { userId: true } },
            offre: {
              select: {
                titre: true,
                entreprise: { select: { userId: true } },
              },
            },
          },
        },
      },
    })
    if (conversation === null) return
    const emetteur = await prisma.user.findUnique({
      where: { id: evenement.emetteurId },
      select: { name: true },
    })
    if (emetteur === null) return

    // `candidature.candidatId` est un Candidat.id : le destinataire est le
    // COMPTE du candidat (`candidat.userId`), jamais l'id de son profil.
    const { candidat, offre } = conversation.candidature
    const destinataireId =
      evenement.emetteurId === candidat.userId
        ? offre.entreprise.userId
        : candidat.userId
    if (!destinataireValide(destinataireId, evenement.emetteurId)) return

    await emettreNotification({
      destinataireId,
      type: 'nouveauMessage',
      refId: evenement.conversationId,
      lien: `/messages/${evenement.conversationId}`,
      variables: {
        type: 'nouveauMessage',
        acteur: emetteur.name,
        compteur: 1,
      },
    })
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `signalementRecu` → notification à CHAQUE administrateur (devoir de
 * modération, non désactivable, emailParDefaut=true). Le payload ne porte
 * QUE le message signalé : la liste des admins est relue ici (elle ne
 * stagne jamais dans un événement). `refId` = messageId : un seul
 * signalement = une notification PAR admin (la clé est unique par couple
 * destinataire+clé).
 */
export async function notifierSignalementRecu(
  evenement: EvenementSignalementRecu,
): Promise<void> {
  try {
    // M10 : seuls les admins ACTIFS reçoivent la file de modération. Un
    // compte suspendu ne doit ni recevoir ni accumuler de notifications.
    const admins = await prisma.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    })
    for (const admin of admins) {
      await emettreNotification({
        destinataireId: admin.id,
        type: 'signalementRecu',
        refId: evenement.messageId,
        lien: '/admin/signalements',
        variables: { type: 'signalementRecu' },
      })
    }
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `moderation` → information de l'AUTEUR du signalement sur la décision
 * rendue. Le payload ne porte que le signalement, le destinataire et la
 * décision fermée : aucun texte du message, aucun nom du mis en cause.
 * `refId` = signalementId : une décision = une notification.
 */
export async function notifierDecisionModeration(evenement: {
  signalementId: number
  auteurId: number
  decision: DecisionSignalement
}): Promise<void> {
  try {
    await emettreNotification({
      destinataireId: evenement.auteurId,
      type: 'moderation',
      refId: evenement.signalementId,
      lien: '/notifications',
      variables: { type: 'moderation', decision: evenement.decision },
    })
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `offrePubliee` → notification à CHAQUE administrateur (parité legacy,
 * in-app seulement : emailParDefaut=false). `refId` = offreId.
 */
export async function notifierOffrePubliee(
  evenement: EvenementOffre,
): Promise<void> {
  try {
    const offre = await prisma.offre.findUnique({
      where: { id: evenement.offreId },
      select: { titre: true, slug: true },
    })
    if (offre === null) return
    const admins = await prisma.user.findMany({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    })
    for (const admin of admins) {
      await emettreNotification({
        destinataireId: admin.id,
        type: 'offrePubliee',
        refId: evenement.offreId,
        lien: `/offres/${offre.slug}`,
        variables: { type: 'offrePubliee', titreOffre: offre.titre },
      })
    }
  } catch (erreur) {
    tracer(erreur)
  }
}

/**
 * `offreIndisponible` → notification à CHAQUE candidat ayant postulé
 * (distinct sur candidatId : un candidat = une notification par offre).
 * `refId` = offreId : clôture PUIS suppression de la même offre regroupe
 * sur la même ligne (l'upsert incrémente, jamais un doublon). La
 * suppression T10 est LOGIQUE (`deletedAt`) : la ligne survit, le titre
 * reste lisible.
 *
 * `candidature.candidatId` est un `Candidat.id` : le destinataire est le
 * COMPTE (`candidat.userId`), jamais l'id du profil.
 */
export async function notifierOffreIndisponible(
  evenement: EvenementOffre,
): Promise<void> {
  try {
    const offre = await prisma.offre.findUnique({
      where: { id: evenement.offreId },
      select: { titre: true },
    })
    if (offre === null) return
    const candidats = await prisma.candidature.findMany({
      where: { offreId: evenement.offreId },
      select: {
        candidatId: true,
        candidat: { select: { userId: true } },
      },
      distinct: ['candidatId'],
    })
    for (const { candidat } of candidats) {
      await emettreNotification({
        destinataireId: candidat.userId,
        type: 'offreIndisponible',
        refId: evenement.offreId,
        lien: '/candidat/candidatures',
        variables: {
          type: 'offreIndisponible',
          titreOffre: offre.titre,
        },
      })
    }
  } catch (erreur) {
    tracer(erreur)
  }
}

/** Tracé d'échec silencieux en production (contrat no-throw des hooks). */
function tracer(erreur: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[notifications] échec de résolution d’événement :', erreur)
  }
}
