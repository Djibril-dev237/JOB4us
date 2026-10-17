import { z } from 'zod'

import { MAX_IDENTIFIANT } from './messagerie-schemas'
import { TYPE_NOTIFICATIONS } from './notifications-labels'

// ─── Schémas Zod — notifications (M9) ────────────────────────────────────────
//
// RÈGLE DES DEUX TEMPS (calque exact de M8, liste blanche M7 reconduite) :
//  1. LA FORME est validée ICI, au bord du serveur : entiers positifs bornés,
//     booléens STRICTS, tuple de curseur, catalogue de types fermé, clés
//     inconnues. `.strict()` partout : une clé non listée (un destinataire
//     injecté, un identifiant d'utilisateur, un booléen en chaîne…) fait
//     ÉCHOUER le parse au lieu d'être écartée en silence — c'est une
//     tentative d'écriture hors contrat, donc refus.
//  2. L'AUTORISATION et l'écriture restent côté action/DAL : la DESTINATION
//     d'une notification est toujours la SESSION (`destinataireId` déduit du
//     serveur, jamais lu dans le payload), le marquage « lu » écrit `lueLe`,
//     la suppression opère sur la ligne APPARTENANT au compte, et le jeton de
//     désabonnement relève de son propre schéma. Aucun de ces champs n'entre
//     ici : ces schémas décrivent UNIQUEMENT ce que le client a le droit de
//     soumettre. Aucune date non plus : `createdAt`/`lueLe` sont écrits par
//     Prisma, jamais par le formulaire.
//
// CATALOGUE ANTI-DIVERGENCE : `TYPE_NOTIFICATIONS` est IMPORTÉ depuis
// notifications-labels.ts (source de vérité du module), jamais recopié.
// `z.enum(TYPE_NOTIFICATIONS)` suit toute évolution du catalogue — ajouter ou
// retirer un type se fait EN UN SEUL endroit, et tout schema « type » rejette
// par construction toute valeur hors liste. Contrairement à M7 (`STATUTS`
// annoté `readonly StatutCandidature[]`, littéraux perdus), le catalogue est
// déjà un tuple `as const` : aucun re-déclaration n'est nécessaire.
//
// BOOLÉENS SANS COERCITION : les préférences sont appelées depuis des
// interrupteurs (`role="switch"`) qui soumettent l'état `checked` de Radix en
// booléen VRAI depuis le composant client — jamais un FormData (qui ne porte
// que des chaînes). `z.boolean()` refuse donc `"true"`, `1`, `"on"` par
// principe : un payload re-coercé ne doit jamais franchir la frontière du
// serveur pour une écriture de préférence.
//
// BORNAGE `MAX_IDENTIFIANT` : repris de `messagerie-schemas.ts`, source
// unique de la constante (déjà importée par les pages/actions M8). Au-delà de
// 2^31−1, Prisma lève `PrismaClientValidationError` hors de toute gestion —
// un id géant (20 chiffres saisi dans l'URL) deviendrait un 500 au lieu d'un
// verdict « forme invalide ».
//
// Aucun message d'erreur affichable n'est inventé ici : Zod porte sa
// sémantique, les bandeaux reviennent aux pages/actions via `TEXTES`
// (notifications-labels.ts) — règle anti-vibecoding du contrat de style.
// ---------------------------------------------------------------------------

// ─── 1) Curseur de pagination « Charger plus » ───────────────────────────────
//
// Curseur COMPOSITE `[createdAt, id]`, calqué sur le curseur temporel de
// messagerie (M8) avec un entier en plus :
//  * `createdAt` est une date ISO-8601 AVEC offset (`2026-01-31T12:00:00Z` ou
//    `…+01:00`) : elle est lue depuis un `createdAt` de Prisma puis réinjectée
//    par le client. Exiger l'offset évite qu'une notification soit renvoyée ou
//    manquée selon le fuseau du navigateur ;
//  * `id` désambiguïse : deux notifications peuvent porter la MÊME seconde
//    d'insertion (rafale d'emails, import legacy), et un tri `(createdAt, id)`
//    stable est la condition pour que « Charger plus » ne boucle jamais sur la
//    même page ni ne saute une ligne.
// Le curseur est optionnel : son ABSENCE vaut premier chargement (calque de
// `schemaCurseurMessages`).

export const schemaCurseurNotifications = z
  .object({
    curseur: z
      .tuple([
        z.string().datetime({ offset: true }),
        z.number().int().positive().max(MAX_IDENTIFIANT),
      ])
      .optional(),
  })
  .strict()

export type CurseurNotifications = z.infer<typeof schemaCurseurNotifications>

// ─── 2) Marquage « comme lu » d'une notification ─────────────────────────────
//
// Seul l'IDENTIFIANT de la cible vient du client : `lueLe` est écrite par le
// serveur au moment du traitement, et l'appartenance de la notification au
// compte (destinataire = session) est vérifiée par l'action — un id étranger
// ne marque rien, et ne doit jamais révéler s'il existe.

export const schemaMarquerNotificationLu = z
  .object({ notificationId: z.number().int().positive().max(MAX_IDENTIFIANT) })
  .strict()

// ─── 3) Marquage global « tout lire » ────────────────────────────────────────
//
// Aucun payload : la cible (TOUTES les notifications non lues du COMPTE) est
// déduite de la session côté action. `.strict()` sur objet VIDE : toute clé
// injectée (`destinataireId`, `notificationId`, `lu`…) fait échouer le parse —
// on ne peut pas glisser une cible ou un filtre dans une action « tout lire ».
// Le schéma existe pour l'uniformité de la couche action : chaque entrée
// serveur passe par un parse, y compris celle sans argument.

export const schemaToutMarquerLu = z.object({}).strict()

// ─── 4) Suppression d'une notification ───────────────────────────────────────
//
// Même forme que le marquage « lu » mais schéma DISTINCT : deux actions aux
// effets différents (un état de lecture vs la suppression de la ligne). Les
// garder séparés évite qu'une évolution future de l'une (un champ
// supplémentaire, une confirmation) ne s'infiltre dans l'autre par
// « réutilisation » du même schema. La suppression est irréversible côté
// utilisateur (la ligne quitte sa liste) — l'action ne cible que SES
// notifications, jamais un id d'autrui.

export const schemaSupprimerNotification = z
  .object({ notificationId: z.number().int().positive().max(MAX_IDENTIFIANT) })
  .strict()

// ─── 5) Préférence email par type ────────────────────────────────────────────
//
// `type` doit appartenir au CATALOGUE : `z.enum(TYPE_NOTIFICATIONS)` rejette
// toute valeur hors liste (casse « Systeme », ancien libellé legacy, chaîne
// libre) — impossible d'inscrire une préférence pour un type que l'émission
// n'enverra jamais. La règle `desactivable` (seul `signalementRecu` ne se
// désactive pas) n'entre PAS ici : c'est une règle métier portée par
// `METADONNEES`/`TYPES_NON_DESACTIVABLES`, croisée par l'action AVANT
// d'écrire — le schema ne juge que la FORME du payload.

export const schemaPreferenceEmailType = z
  .object({
    type: z.enum(TYPE_NOTIFICATIONS),
    emailActive: z.boolean(),
  })
  .strict()

export type PreferenceEmailType = z.infer<typeof schemaPreferenceEmailType>

// ─── 6) Réglage du résumé quotidien ──────────────────────────────────────────
//
// Booléen STRICT (voir en-tête : switch → booléen, jamais « on »). Ce réglage
// est INDÉPENDANT du catalogue : il porte sur la synthèse quotidienne des
// notifications non lues par email, pas sur un type précis — d'où un schema
// dédié et non une variante du précédent.

export const schemaReglageResumeQuotidien = z
  .object({ resumeQuotidien: z.boolean() })
  .strict()
