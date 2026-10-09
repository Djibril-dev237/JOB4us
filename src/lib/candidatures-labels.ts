import type { StatutCandidature } from '@prisma/client'

import type { BadgeVariant } from '@/components/ui/badge'

// ─── Libellés et dérivés du cycle de vie des candidatures (M7) ────────────────
// Contrat INTER-VAGUES : pages, actions et composants importent ICI leurs
// libellés, variants, chips de filtre et clés de bandeau — jamais de texte
// recopié entre écrans (calque exact de src/lib/offres-labels.ts, motif repris
// de src/lib/definitions.ts : LABELS + VALUES + types seuls, AUCUN import
// RUNTIME de @prisma/client puisque ce module est importé côté client aussi
// bien que côté serveur).
//
// Décisions validées (étape 2) qui se matérialisent ici :
//  * 7 statuts stockés (enum StatutCandidature) : `vue` → `consultee`,
//    `retenue` → `preselectionnee` (terminologie validée), `acceptee` est
//    nouvelle, `retiree` remplace la SUPPRESSION PHYSIQUE du legacy
//    (diagnostic #11 : l'historique M7 doit survivre) ;
//  * badges : envoyee=brand, consultee=neutral, preselectionnee=accent,
//    entretien=warn, acceptee=ok, refusee=danger, retiree=neutral ;
//  * chips de liste : DEUX terminologies legacy conservées — pluriels côté
//    candidat, singuliers côté recruteur, `toutes` en tête = aucun filtre ;
//  * matrice de transitions (TRANSITIONS) : source UNIQUE des droits
//    `peutTransiter` / `transitionsAutorisees`, verrouillée par un test
//    exhaustif (7 statuts × 3 acteurs × 7 cibles) ;
//  * `?maj=` : clés de retour des actions serveur → bandeau affiché par la
//    page cible ; MESSAGES_MAJ_CANDIDATURE est la source unique des textes
//    (actions comme pages l'empruntent) ;
//  * `?erreur=` : refus des actions → bandeau ; MESSAGES_ERREUR_CANDIDATURE
//    est la source unique, fail-closed comme M6 : clé inconnue ou absente →
//    aucun bandeau, jamais de texte non contrôlé depuis l'URL. Les clés
//    legacy de M6 (`statut`, `date`, `quota`, `limite`) restent dans
//    offres-labels.ts — non dupliquées ici.
// ---------------------------------------------------------------------------

/** Acteur qui demande (ou subit) une transition : le droit dépend de lui. */
export type ActeurCandidature = 'candidat' | 'recruteur' | 'admin'

/**
 * Les 7 statuts de l'enum Prisma, dans l'ordre de la fiche de suivi.
 * Couverture verrouillée par le test contre `Object.values(StatutCandidature)`
 * (anti-divergence, motif de offres-labels.test.ts).
 */
export const STATUTS: readonly StatutCandidature[] = [
  'envoyee',
  'consultee',
  'preselectionnee',
  'entretien',
  'acceptee',
  'refusee',
  'retiree',
]

/** Clés de bandeau `?maj=` des retours des actions serveur (postuler, retirer). */
export type CleMajCandidature = 'envoyee' | 'retiree'

/** Clés de bandeau `?erreur=` (ou FormState) des refus M7. */
export type CleErreurCandidature =
  | 'doublon'
  | 'offre-indisponible'
  | 'profil-incomplet'
  | 'fichier-invalide'
  | 'echec-stockage'
  | 'trop-de-demandes'
  | 'transition'
  | 'retrait'

// ─── Singuliers (badges) ─────────────────────────────────────────────────────
//
// UN seul badge par ligne : les libellés singuliers sont donc identiques
// côté candidat ET côté recruteur (la terminologie validée en étape 2
// s'applique des deux côtés : `consultee` = « Consultée », pas l'ancienne
// « Vue »). Les pluriels ne vivent QUE dans les chips de filtre ci-dessous.

export const LIBELLES_STATUT: Record<StatutCandidature, string> = {
  envoyee: 'Envoyée',
  consultee: 'Consultée',
  preselectionnee: 'Présélectionnée',
  entretien: 'Entretien',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  retiree: 'Retirée',
}

// ─── Variants de badge (décision d'intégration) ──────────────────────────────
//
// `accent` sert d'état de PROGRESSION (« Présélectionnée »), pas de marqueur
// de marque — `VARIANTE_STATUT` de M6 n'utilise pas `accent`, `ok` reste
// réservé au résultat final « Acceptée ». Le statut `retiree` s'affiche en
// plus avec une opacité faible côté ligne : ce fichier fournit UNIQUEMENT la
// variante (l'opacité est une décision de rendu, pas une variante).

export const VARIANTE_STATUT: Record<StatutCandidature, BadgeVariant> = {
  envoyee: 'brand',
  consultee: 'neutral',
  preselectionnee: 'accent',
  entretien: 'warn',
  acceptee: 'ok',
  refusee: 'danger',
  retiree: 'neutral',
}

// ─── Chips de filtre (listes candidat | recruteur) ───────────────────────────
//
// DEUX tables distinctes : le legacy affichait des pluriels au candidat
// (« Envoyées, Vues, Retenues, Entretien, Refusées ») et des singuliers au
// recruteur (« Nouvelle, Vue, Retenue, Entretien, Refusée ») ; la
// terminologie validée en étape 2 remplace « Vue » par
// « Consultées »/« Consultée » et « Retenue(s) » par
// « Présélectionnée(s) ». Les VALEURS sont identiques des deux côtés (les 7
// statuts + `toutes`, dans l'ordre STATUTS) : seuls les libellés changent.
//
// `toutes` = aucun filtre : le DAL lit une valeur absente comme « pas de
// predicate », et elle occupe toujours la première position (alignée sur les
// chips legacy).

export const VALEURS_FILTRE_CANDIDATURE = {
  candidat: [
    'toutes',
    'envoyee',
    'consultee',
    'preselectionnee',
    'entretien',
    'acceptee',
    'refusee',
    'retiree',
  ],
  recruteur: [
    'toutes',
    'envoyee',
    'consultee',
    'preselectionnee',
    'entretien',
    'acceptee',
    'refusee',
    'retiree',
  ],
} as const

export type ValeurFiltreCandidature =
  (typeof VALEURS_FILTRE_CANDIDATURE)[keyof typeof VALEURS_FILTRE_CANDIDATURE][number]

export type OptionsFiltreCandidature = ReadonlyArray<{
  valeur: ValeurFiltreCandidature
  libelle: string
}>

export const OPTIONS_FILTRE_CANDIDATURE: Record<
  'candidat' | 'recruteur',
  OptionsFiltreCandidature
> = {
  candidat: [
    { valeur: 'toutes', libelle: 'Toutes' },
    { valeur: 'envoyee', libelle: 'Envoyées' },
    { valeur: 'consultee', libelle: 'Consultées' },
    { valeur: 'preselectionnee', libelle: 'Présélectionnées' },
    { valeur: 'entretien', libelle: 'Entretien' },
    { valeur: 'acceptee', libelle: 'Acceptées' },
    { valeur: 'refusee', libelle: 'Refusées' },
    { valeur: 'retiree', libelle: 'Retirées' },
  ],
  recruteur: [
    { valeur: 'toutes', libelle: 'Toutes' },
    { valeur: 'envoyee', libelle: 'Nouvelle' },
    { valeur: 'consultee', libelle: 'Consultée' },
    { valeur: 'preselectionnee', libelle: 'Présélectionnée' },
    { valeur: 'entretien', libelle: 'Entretien' },
    { valeur: 'acceptee', libelle: 'Acceptée' },
    { valeur: 'refusee', libelle: 'Refusée' },
    { valeur: 'retiree', libelle: 'Retirée' },
  ],
}

// ─── Machine à états (étape 2 validée — matrice littérale) ───────────────────
//
// Toute combinaison ABSENTE de ce tableau est INTERDITE, y compris
// `consultee→entretien`, `envoyee→refusee`, `consultee→refusee`, toute cible
// `envoyee` et toute transition depuis `retiree`. Notes de la décision :
//  * `consultee` se déclenche AUTO côté serveur à l'ouverture de la fiche
//    recruteur (jamais depuis le client : l'acteur du passage est le
//    serveur, pas un bouton) ;
//  * `envoyee` n'est jamais une cible de transition : seul le CREATE écrit
//    ce statut (colonne `@default(envoyee)`) ;
//  * `retiree` remplace la suppression physique du legacy (la ligne et son
//    historique survivent) ;
//  * `acceptee` / `refusee` sont terminaux POUR LE CANDIDAT (il ne peut plus
//    rien faire), le recruteur garde la réouverture vers `preselectionnee`
//    et l'admin peut retirer ;
//  * la réouverture (→ `preselectionnee`) est tracée par l'audit M7.
const TRANSITIONS: Record<
  StatutCandidature,
  Record<ActeurCandidature, readonly StatutCandidature[]>
> = {
  envoyee: {
    candidat: ['retiree'],
    recruteur: ['consultee', 'preselectionnee', 'entretien'],
    admin: ['consultee', 'preselectionnee', 'entretien'],
  },
  consultee: {
    candidat: ['retiree'],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee'],
  },
  preselectionnee: {
    candidat: ['retiree'],
    recruteur: ['entretien', 'acceptee', 'refusee'],
    admin: ['entretien', 'acceptee', 'refusee'],
  },
  entretien: {
    candidat: ['retiree'],
    recruteur: ['preselectionnee', 'acceptee', 'refusee'],
    admin: ['preselectionnee', 'acceptee', 'refusee'],
  },
  acceptee: {
    candidat: [],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee', 'retiree'],
  },
  refusee: {
    candidat: [],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee', 'retiree'],
  },
  retiree: {
    candidat: [],
    recruteur: [],
    admin: [],
  },
}

/**
 * La transition `depuis` → `vers` est-elle autorisée à l'acteur `acteur` ?
 * Source unique : la matrice TRANSITIONS ci-dessus — fail-closed, toute
 * combinaison absente est refusée (les contrôles serveur appellent CE
 * prédicat, jamais une logique recopiée dans l'action).
 *
 * Fail-closed AUSSI sur une entrée hors ENUM (statut legacy `'vue'`, acteur
 * inconnu — un cast TS ou un seed raté) : la table est lue via une vue
 * partielle et une entrée inconnue vaut `[]`, donc refus — jamais un
 * TypeError qui transformerait un refus en 500 (revue Vague 1, C3).
 */
const TABLE_TRANSITIONS_PARTIELLE = TRANSITIONS as Partial<
  Record<StatutCandidature, Partial<Record<ActeurCandidature, readonly StatutCandidature[]>>>
>

function ciblesAutorisees(
  depuis: StatutCandidature,
  acteur: ActeurCandidature,
): readonly StatutCandidature[] {
  return TABLE_TRANSITIONS_PARTIELLE[depuis]?.[acteur] ?? []
}

export function peutTransiter(
  depuis: StatutCandidature,
  vers: StatutCandidature,
  acteur: ActeurCandidature,
): boolean {
  return ciblesAutorisees(depuis, acteur).includes(vers)
}

/**
 * Cibles atteignables depuis `depuis` pour l'`acteur` (matrice TRANSITIONS).
 * COPIE défensive (revue Vague 1, O1) : l'appelant ne peut pas muter la
 * table vivante partagée par tout le module (ni le client, via le Server
 * Components payload).
 */
export function transitionsAutorisees(
  depuis: StatutCandidature,
  acteur: ActeurCandidature,
): readonly StatutCandidature[] {
  return [...ciblesAutorisees(depuis, acteur)]
}

/** Statuts sur lesquels la candidature se fige (pour le candidat). */
export const STATUTS_TERMINAUX: readonly StatutCandidature[] = [
  'acceptee',
  'refusee',
  'retiree',
]

// ─── Bandeaux `?maj=` (retours des actions serveur) ──────────────────────────
//
// Clés de SUCCÈS des actions de postulation et de retrait (les clés legacy de
// M6 — `statut`, `date`, `quota`, `limite` — restent dans offres-labels.ts).

export const MESSAGES_MAJ_CANDIDATURE: Record<CleMajCandidature, string> = {
  envoyee: 'Candidature envoyée.',
  retiree: 'Candidature retirée.',
}

/**
 * Bandeau pour un paramètre `?maj=` : clé inconnue, absente ou non chaîne →
 * `null` (aucun bandeau, jamais de texte non contrôlé affiché depuis l'URL).
 */
export function messageMajCandidature(
  cle: string | null | undefined,
): string | null {
  if (cle === null || cle === undefined) return null
  return Object.prototype.hasOwnProperty.call(MESSAGES_MAJ_CANDIDATURE, cle)
    ? MESSAGES_MAJ_CANDIDATURE[cle as CleMajCandidature]
    : null
}

// ─── Bandeaux `?erreur=` (refus des actions serveur) ─────────────────────────
//
// Fail-closed comme `?maj=` : clé inconnue ou absente → aucun bandeau, jamais
// de texte non contrôlé affiché depuis l'URL. Échec de propriété = 404, jamais
// `?erreur=`.

export const MESSAGES_ERREUR_CANDIDATURE: Record<CleErreurCandidature, string> = {
  /** Postulation déjà existante pour ce candidat + cette offre. */
  doublon: 'Vous avez déjà postulé à cette offre.',
  /** L'offre n'est plus publiable / plus disponible (décision étape 2). */
  'offre-indisponible': "Cette offre n'est plus disponible.",
  /** Aucun CV sur le profil et aucune source de fichier (option A validée). */
  'profil-incomplet': 'Ajoutez un CV à votre profil avant de postuler.',
  /** Fichier rejeté par validateUpload (type, taille ou signature) — texte
   *  libre assumé (revue Vague 1, C1) : aucun libellé du cahier des charges
   *  ne couvre ce refus de fichiers ; il complète `profil-incomplet`. */
  'fichier-invalide': 'Le fichier sélectionné n’est pas un CV valide (format ou taille).',
  /** Échec du stockage objet pendant le snapshot — texte libre assumé (C1). */
  'echec-stockage': 'L’envoi du CV a échoué. Réessayez plus tard.',
  /** Seau de tentatives (style rate-limit). */
  'trop-de-demandes': 'Trop de tentatives. Réessayez plus tard.',
  /** Transition refusée par la matrice TRANSITIONS. */
  transition: "Ce changement de statut n'est pas autorisé.",
  /** Retrait impossible (statut terminal ou ligne déjà retirée). */
  retrait: 'Impossible de retirer cette candidature.',
}

export function messageErreurCandidature(
  cle: string | null | undefined,
): string | null {
  if (cle === null || cle === undefined) return null
  return Object.prototype.hasOwnProperty.call(MESSAGES_ERREUR_CANDIDATURE, cle)
    ? MESSAGES_ERREUR_CANDIDATURE[cle as CleErreurCandidature]
    : null
}
