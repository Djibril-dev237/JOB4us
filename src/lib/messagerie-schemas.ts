import { z } from 'zod'

import { GARDE_LONGUEUR_BRUT } from './messagerie-contenu'

// ─── Schémas Zod — messagerie (M8, Vague 1) ──────────────────────────────────
//
// RÈGLE DES DEUX TEMPS (M8, contraire assumé de M7) :
//  1. LA FORME est validée ICI, au bord du serveur : types (entier positif,
//     chaîne), bornes, clés inconnues. `.strict()` partout : une clé non
//     listée (un auteur injecté, un statut, un chemin de fichier…) fait
//     ÉCHOUER le parse au lieu d'être écartée en silence — c'est une
//     tentative d'écriture hors contrat, donc refus.
//  2. LE NETTOYAGE et la longueur FINALE (retrait de balises, caractères
//     de contrôle, bornage, troncature en points de code) appartiennent aux
//     ACTIONS serveur, via `nettoyerMessage`/`nettoyerMotif`
//     (messagerie-contenu.ts) — JAMAIS ici. Un schema doit rester une
//     fonction pure de validation : y insérer le nettoyage ferait que le
//     même payload parserait différemment selon le chemin d'appel, et
//     masquerait des saisies « corrigées » que l'utilisateur croit
//     envoyées telles quelles. L'action nettoie PUIS applique la borne
//     réelle (`LONGUEUR_MAX_MESSAGE`, `LONGUEUR_MAX_MOTIF`).
//
// POUR `GARDE_LONGUEUR_BRUT` (8000) et non la cible réelle (2000/300) :
// le schema rejette le payload BRUT, AVANT nettoyage. C'est un garde
// anti-DoS — la boîte de travail est bornée avant toute allocation
// coûteuse (retrait de balises, segmentation UTF-8). La longueur finale
// après nettoyage est bien 2000/300, mais elle est appliquée par l'action
// (voir règle 2) : la borne du schema doit être la borne du BRUT, sinon un
// message de 2000 caractères remplis de balises serait tronqué par le
// schema au milieu d'une séquence qu'aucune coupe ne peut rendre sûre.
// Aucun champ du payload n'est identité ni autorisation : `auteurId`,
// `destinataireId`, `conversationId` de l'expéditeur… sont déduits de la
// SESSION côté action, jamais lus dans le payload (liste blanche M7,
// reconduite ici).
// ---------------------------------------------------------------------------

/**
 * Plafond des identifiants MySQL `Int` (signé 32 bits).
 *
 * AU-DELÀ, Prisma lève `PrismaClientValidationError` hors de toute gestion —
 * un id géant (20 chiffres saisi dans l'URL) deviendrait une erreur 500 au
 * lieu d'un verdict « forme invalide ». Bornage au bord du serveur : chaque
 * schéma refuse, chaque parse numérique hors schéma (paramètre de route,
 * query d'API) rejoue la même borne (critère M8 « zéro 500 »).
 */
export const MAX_IDENTIFIANT = 2_147_483_647

// ─── 1) Envoi d'un message dans une conversation ─────────────────────────────

export const schemaEnvoyerMessage = z
  .object({
    conversationId: z.number().int().positive().max(MAX_IDENTIFIANT),
    contenu: z.string().min(1).max(GARDE_LONGUEUR_BRUT),
  })
  .strict()

// ─── 2) Paginage d'une conversation (curseur temporel) ──────────────────────
//
// Le curseur est une date ISO-8601 AVEC offset (`2026-01-31T12:00:00Z` ou
// `…+01:00`) : elle est lue depuis un `createdAt` de Prisma puis réinjectée
// par le client. Exiger l'offset évite qu'un même message soit renvoyé ou
// manqué selon le fuseau du navigateur.

export const schemaCurseurMessages = z
  .object({
    conversationId: z.number().int().positive().max(MAX_IDENTIFIANT),
    curseur: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

// ─── 3) Masquage d'une conversation (cachée pour l'utilisateur) ─────────────
//
// C'est un MASQUAGE côté expéditeur : la conversation et l'autre partie ne
// sont pas supprimées. La réciprocité (l'autre voit toujours) relève de
// l'action, pas du schema.

export const schemaMasquerConversation = z
  .object({ conversationId: z.number().int().positive().max(MAX_IDENTIFIANT) })
  .strict()

// ─── 4) Blocage d'un utilisateur (fin de toute nouvelle conversation) ───────
//
// La CIBLE est `cibleUserId` (et non `userId`) pour rendre impossible une
// inversion sujet/objet dans l'action : on ne peut pas bloquer « par
// erreur » son propre identifiant en lisant le payload à l'envers.

export const schemaBloquerUtilisateur = z
  .object({ cibleUserId: z.number().int().positive().max(MAX_IDENTIFIANT) })
  .strict()

// ─── 5) Signalement d'un message (motif saisi par le signalant) ─────────────
//
// `motif` est saisi librement (3 caractères minimum pour décourager le
// signalement « x » par réflexe) et borné, comme `contenu`, à la garde
// BRUTE : le nettoyage réel et la borne à `LONGUEUR_MAX_MOTIF` (300)
// reviennent à l'action.

export const schemaSignalerMessage = z
  .object({
    messageId: z.number().int().positive().max(MAX_IDENTIFIANT),
    motif: z.string().min(3).max(GARDE_LONGUEUR_BRUT),
  })
  .strict()

// ─── 6) Traitement d'un signalement (modération admin) ──────────────────────
//
// La DÉCISION (conserver, masquer, sanctionner) n'est PAS dans le payload :
// ce schema ne porte que la note d'escalade. Les actions distinctes et leur
// garde d'acteur (admin uniquement) vivent dans le DAL de modération.

export const schemaTraiterSignalement = z
  .object({
    signalementId: z.number().int().positive().max(MAX_IDENTIFIANT),
    noteInterne: z.string().max(2000).optional(),
  })
  .strict()
