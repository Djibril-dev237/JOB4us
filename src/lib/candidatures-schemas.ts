import { z } from 'zod'

import { STATUTS } from './candidatures-labels'

// ─── Schémas Zod — candidatures (M7) ─────────────────────────────────────────
//
// DOCTRINE SÉCURITÉ M7 (étape 2, tâche 2) — liste blanche stricte : ces
// schémas décrivent UNIQUEMENT ce que le CLIENT a le droit de soumettre.
// `statut`, `candidatId`/`candidateId`, `offreId`, `cvPath` (ou toute clé
// d'objet) et toute date système ne viennent JAMAIS du client :
//  * la cible d'une transition est lue dans l'URL / le contexte de route,
//    puis validée par `schemaChangementStatut` — son AUTORISATION dépend de
//    la matrice TRANSITIONS et de l'acteur (candidatures-labels.ts) ;
//  * l'identifiant d'offre de la postulation est déduit du CONTEXTE de route
//    par l'action serveur, pas du payload ;
//  * le candidat est celui de la SESSION ; `cvPath` est lu côté serveur sur
//    `Candidat.cvPath` (source `profil`) ou calculé par l'upload (source
//    `fichier`) — jamais repris d'une saisie ;
//  * aucune date : `createdAt`/`updatedAt`/`consulteeAt` sont écrits par
//    Prisma, jamais par le formulaire.
//
// `.strict()` partout : une clé inconnue (statut injecté, candidateId,
// offreId, cvPath…) fait ÉCHOUER le parse au lieu d'être écartée en silence
// — comportement testé. Contraste assumé avec `OffreFormSchema` (M6) qui
// `.strip()` : là le périmètre de formulaire est legacy-complet et une clé
// de trop n'est qu'un souci d'URL ; ici TOUT ce qui n'est pas listé est une
// tentative d'écriture hors contrat, donc refus.
// ---------------------------------------------------------------------------

// `z.enum` reçoit un TUPLE littéral : `STATUTS` (côté labels) est annoté
// `readonly StatutCandidature[]`, il a donc perdu ses littéraux. On
// redéclare ici les 7 valeurs `as const`, MÊME ordre que `STATUTS`, sans
// aucun `any` — et l'alignement est contrôlé ci-dessous.
const STATUTS_TUPLE = [
  'envoyee',
  'consultee',
  'preselectionnee',
  'entretien',
  'acceptee',
  'refusee',
  'retiree',
] as const

// Contrôle de dérivation (fail-fast, texte développeur) : `STATUTS` reste la
// source unique des 7 statuts ; si le tuple ci-dessus diverge (ordre, lettre
// manquante, valeur fantôme), le module refuse de se charger plutôt que de
// valider un statut inconnu. Le test de couverture verrouille aussi
// STATUTS = tuple = enum Prisma.
const STATUTS_ALIGNE =
  STATUTS_TUPLE.length === STATUTS.length &&
  STATUTS.every((statut, index) => STATUTS_TUPLE[index] === statut)
if (!STATUTS_ALIGNE) {
  throw new Error('STATUTS_TUPLE doit reprendre exactement STATUTS (candidatures-labels).')
}

// ─── Textes d'issues (erreurs de champ) ──────────────────────────────────────
//
// Le cahier des charges M7 fournit les textes de BANDEAUX (labels) mais
// aucun libellé d'erreur de champ : les 8 formulations ci-dessous sont
// rédigées ici au style de definitions.ts (français, une phrase, pas de
// jargon Zod) — POINT À VALIDER lors de l'intégration.
const ERREUR_LETTRE =
  'La lettre de motivation ne peut pas dépasser 3000 caractères.'
const ERREUR_SOURCE_CV = 'Source du CV invalide : « profil » ou « fichier » attendu.'
const ERREUR_FICHIER = 'Fichier CV invalide.'
const ERREUR_FICHIER_REQUIS = 'Fichier CV requis : la source vaut « fichier ».'
const ERREUR_FICHIER_INATTENDU =
  'Aucun fichier attendu : la source vaut « profil » (le CV du profil est utilisé).'
const ERREUR_STATUT = 'Statut de candidature inconnu.'
const ERREUR_PAGE = 'Numéro de page invalide : un entier supérieur ou égal à 1 est attendu.'
const ERREUR_OFFRE =
  'Filtre d’offre invalide : un entier supérieur ou égal à 1 est attendu.'

// ─── 1) Payload de postulation (FormData) ────────────────────────────────────
//
// Reprend le legacy `lettre_motivation` (`nullable|string|max:3000`) sous
// forme optionnelle, plus la SOURCE du CV (décision étape 2, option A) :
// `profil` = le serveur lit `Candidat.cvPath`, `fichier` = un `File` est
// requis. Aucune clé d'identification dans ce payload.

export const schemaPostulation = z
  .object({
    lettreMotivation: z.string().max(3000, { error: ERREUR_LETTRE }).optional(),
    sourceCv: z.enum(['profil', 'fichier'], { error: ERREUR_SOURCE_CV }),
    fichier: z.instanceof(File, { error: ERREUR_FICHIER }).optional(),
  })
  .strict()
  .superRefine((valeur, ctx) => {
    if (valeur.sourceCv === 'fichier' && valeur.fichier === undefined) {
      ctx.addIssue({ code: 'custom', path: ['fichier'], message: ERREUR_FICHIER_REQUIS })
    }
    if (valeur.sourceCv === 'profil' && valeur.fichier !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['fichier'], message: ERREUR_FICHIER_INATTENDU })
    }
  })

export type PostulationClient = z.infer<typeof schemaPostulation>

// ─── 2) Changement de statut (recruteur/admin) ───────────────────────────────
//
// La CIBLE vient de l'URL/contexte (jamais du formulaire) : ce schéma ne
// contrôle que l'appartenance aux 7 valeurs — le droit (acteur, statut
// courant) est `peutTransiter()` côté serveur.

export const schemaChangementStatut = z
  .object({
    statut: z.enum(STATUTS_TUPLE, { error: ERREUR_STATUT }),
  })
  .strict()

// ─── 3) Filtres de liste (query string — lecture SEULEMENT) ──────────────────
//
// `page`/`offreId` arrivent en chaîne dans l'URL : coercition numérique puis
// entier ≥ 1. `offreId` est un filtre LECTEUR : le DAL le croise avec
// l'appartenance de l'offre au compte (un id étranger ne filtre rien, il ne
// déclenche jamais une erreur de propriété distincte). Le nom `offreId`
// aligne le schéma sur `FiltresCandidatures.offreId` du DAL : pas de
// mapping manuel au moment de la lecture (revue Vague 1, O3).
//
// `.strict()` implique pour la V2 : ne parser QUE ces 3 clés (un `?maj=`
// ou un paramètre de tracking ferait échouer le parse), et la chip
// « Toutes » doit s'exprimer par l'ABSENCE du paramètre `statut`.

export const schemaFiltreCandidatures = z
  .object({
    statut: z.enum(STATUTS_TUPLE, { error: ERREUR_STATUT }).optional(),
    page: z.coerce
      .number({ error: ERREUR_PAGE })
      .int({ error: ERREUR_PAGE })
      .min(1, { error: ERREUR_PAGE })
      .optional(),
    offreId: z.coerce
      .number({ error: ERREUR_OFFRE })
      .int({ error: ERREUR_OFFRE })
      .min(1, { error: ERREUR_OFFRE })
      .optional(),
  })
  .strict()
