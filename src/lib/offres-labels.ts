import type { StatutOffre } from '@prisma/client'

import type { BadgeVariant } from '@/components/ui/badge'

import { estExpiree } from './douala'

// ─── Libellés et dérivés du cycle de vie des offres (M6, préalable P2) ───────
// Contrat INTER-VAGUES : pages, actions et composants importent ICI leurs
// libellés et clés de statut — jamais de texte recopié entre écrans
// (anti-divergence, motif repris de src/lib/definitions.ts : LABELS +
// VALUES + types seuls, AUCUN import RUNTIME de @prisma/client puisque ce
// module est importé côté client aussi bien que côté serveur).
//
// Décisions validées (étapes 2 et 3) qui se matérialisent ici :
//  * 4 statuts STOCKÉS (enum StatutOffre) + 2 états DÉRIVÉS à l'affichage :
//    « expirée » (date passée à Douala — recalculée à chaque lecture, aucun
//    cron) et « supprimée » (jamais affichée : la ligne sort de toutes les
//    lectures via deletedAt, donc aucun libellé ni option ne la mentionne) ;
//  * badges : publiée=ok, brouillon=neutral, expirée=warn, clôturée=neutral,
//    suspendue=danger (étape 3, gamme de variants de ui/badge) ;
//  * filtre du dashboard : « Toutes · Brouillons · Publiées · Expirées ·
//    Clôturées · Suspendues » (étape 3, ordre exact) — « expirée » est la
//    seule valeur de filtre qui n'existe pas en base ;
//  * D4 : plafond de 20 offres simultanément `publiee` par compte ;
//  * `?maj=` : clés de retour des actions serveur → bandeau affiché par la
//    page cible (étape 3) — la table MESSAGES_MAJ est la source unique des
//    textes, actions comme pages l'empruntent.
//  * `?erreur=` : transitions refusées par la matrice T1-T11 (conflit de
//    statut, D3, D4 ou D6) → bandeau d'erreur sur le dashboard, source unique
//    MESSAGES_ERREUR_TRANSITION (jamais de texte libre dans l'URL).
// ---------------------------------------------------------------------------

/** Statut d'affichage : enum stocké + état dérivé « expirée ». */
export type StatutAffiche = StatutOffre | 'expiree'

export const LIBELLES_STATUT: Record<StatutAffiche, string> = {
  brouillon: 'Brouillon',
  publiee: 'Publiée',
  cloturee: 'Clôturée',
  suspendue: 'Suspendue',
  expiree: 'Expirée',
}

export const VARIANTE_STATUT: Record<StatutAffiche, BadgeVariant> = {
  brouillon: 'neutral',
  publiee: 'ok',
  cloturee: 'neutral',
  suspendue: 'danger',
  expiree: 'warn',
}

/** Champs minimaux nécessaires pour afficher un statut cohérent. */
export interface StatutAffichable {
  statut: StatutOffre
  dateExpiration: Date
}

/**
 * Statut à AFFICHER pour une offre : les statuts non publiés passent tels
 * quels (leur date d'expiration ne change rien — une clôturée passée reste
 * « Clôturée »), seule une offre `publiee` dont la date est échue bascule en
 * « expirée ». Côté serveur (D12) : la page dérive le statut, le composant
 * ne fait qu'afficher.
 */
export function statutAffiche(
  offre: StatutAffichable,
  now: Date = new Date(),
): StatutAffiche {
  if (offre.statut !== 'publiee') return offre.statut
  return estExpiree(offre.dateExpiration, now) ? 'expiree' : 'publiee'
}

// ─── Filtre du dashboard ─────────────────────────────────────────────────────

/**
 * Valeurs acceptées du paramètre `statut` (URL du dashboard) : les 4
 * statuts stockés, « expiree » (dérivé) et '' (Toutes). Ordre aligné sur
 * les options affichées.
 */
export const VALEURS_FILTRE_STATUT = [
  '',
  'brouillon',
  'publiee',
  'expiree',
  'cloturee',
  'suspendue',
] as const

export type ValeurFiltreStatut = (typeof VALEURS_FILTRE_STATUT)[number]

export const OPTIONS_FILTRE_STATUT: ReadonlyArray<{
  valeur: ValeurFiltreStatut
  libelle: string
}> = [
  { valeur: '', libelle: 'Toutes' },
  { valeur: 'brouillon', libelle: 'Brouillons' },
  { valeur: 'publiee', libelle: 'Publiées' },
  { valeur: 'expiree', libelle: 'Expirées' },
  { valeur: 'cloturee', libelle: 'Clôturées' },
  { valeur: 'suspendue', libelle: 'Suspendues' },
]

// ─── Politique de publication ────────────────────────────────────────────────

/**
 * D4 (étape 2 validée) : plafond d'offres simultanément `publiee` par
 * compte recruteur. Ne compte NI les brouillons ni les clôturées — une
 * offre qui repasse en brouillon libère son quota. Contrôlé côté serveur
 * au moment de publier (jamais seulement dans l'interface).
 */
export const OFFRES_ACTIVES_MAX = 20

// ─── Bandeaux `?maj=` (retours des actions serveur) ──────────────────────────

export type CleMaj =
  | 'brouillon'
  | 'modifiee'
  | 'publiee'
  | 'cloturee'
  | 'rouverte'
  | 'dupliquee'
  | 'supprimee'
  | 'suspendue'
  | 'levee'

export const MESSAGES_MAJ: Record<CleMaj, string> = {
  brouillon: 'Brouillon enregistré.',
  modifiee: 'Modifications enregistrées.',
  publiee: 'Offre publiée.',
  cloturee: 'Offre clôturée.',
  rouverte: 'Offre rouverte en brouillon.',
  dupliquee: 'Offre dupliquée en brouillon.',
  supprimee: 'Offre supprimée.',
  suspendue: 'Offre suspendue.',
  levee: 'Suspension levée : l’offre est revenue en brouillon.',
}

/**
 * Bandeau pour un paramètre `?maj=` : clé inconnue, absente ou non chaîne
 * → `null` (aucun bandeau, jamais de texte non contrôlé affiché depuis
 * l'URL).
 */
export function messageMaj(cle: string | null | undefined): string | null {
  if (cle === null || cle === undefined) return null
  return Object.prototype.hasOwnProperty.call(MESSAGES_MAJ, cle)
    ? MESSAGES_MAJ[cle as CleMaj]
    : null
}

// ─── Bandeaux `?erreur=` (transitions refusées, Vague 2) ─────────────────────
//
// Les actions de transition (publier, clôturer…) répondent par une
// REDIRECTION, pas par un FormState : en cas de refus (matrice T1-T11,
// D3, D4) elles passent par un paramètre `?erreur=` dont la table ci-
// dessous est la source UNIQUE — fail-closed comme `?maj=` : clé inconnue
// ou absente → aucun bandeau, jamais de texte non contrôlé affiché depuis
// l'URL. Échec de propriété (offre étrangère) = 404, jamais `?erreur=`.

export type CleErreurTransition = 'statut' | 'date' | 'quota' | 'limite'

export const MESSAGES_ERREUR_TRANSITION: Record<CleErreurTransition, string> = {
  /** Transition impossible depuis le statut courant (ou offre expirée). */
  statut: 'Cette action n’est plus disponible pour cette offre.',
  /** D3 : publication avec une date d’expiration déjà passée à Douala. */
  date: 'La date d’expiration doit être postérieure ou égale à aujourd’hui pour publier.',
  /** D4 : plafond d’offres `publiee` simultanées atteint. */
  quota: `Nombre maximum d’offres publiées atteint (${OFFRES_ACTIVES_MAX}).`,
  /** D6 : seau de 10 créations/heure (création ET duplication). */
  limite: 'Trop de créations récentes : réessayez dans une heure.',
}

export function messageErreurTransition(
  cle: string | null | undefined,
): string | null {
  if (cle === null || cle === undefined) return null
  return Object.prototype.hasOwnProperty.call(MESSAGES_ERREUR_TRANSITION, cle)
    ? MESSAGES_ERREUR_TRANSITION[cle as CleErreurTransition]
    : null
}
