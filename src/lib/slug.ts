// ─── Slugs d'URL des offres publiques (M5, task 4) ──────────────────────────
//
// Contrat d'URL (étape 3, décision 1) : /offres/<slug> avec
// slug = slugifierTitre(titre) + '-' + id, ex. « developpeur-back-end-42 ».
// L'identifiant en suffixe garantit l'unicité (deux offres de même titre)
// et dispense de tout UPDATE de masse si un titre est corrigé.
// L'ancien format legacy (/offres/<id> numérique) répond 404 : le regex
// ci-dessous le rejette AVANT toute requête base.
//
// Le backfill SQL de la migration 20261003164500 applique EXACTEMENT la
// même règle (27 remplacements d'accent + [^a-z0-9]+ → '-' + trim + COALESCE
// 'offre') : toute divergence ferait que la base et la logique M6 produiraient
// des URL différentes — c'est pourquoi les deux côtés sont testés.
// ---------------------------------------------------------------------------

/**
 * Slug d'offre attendu : segments [a-z0-9] séparés par des tirets uniques,
 * terminés par l'id strictement positif (1-9 puis 0-9*).
 * Rejette en particulier : '42' (legacy), majuscules, tirets en bord,
 * tirets doubles, id à zéro ou à zéro initial.
 */
export const SLUG_OFFRE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*-[1-9][0-9]*$/

/**
 * Titre → segment de slug : NFD puis retrait des combinants (accents),
 * ligatures françaises explicites, minuscules, tout ce qui n'est pas
 * [a-z0-9] devient un tiret, bords tranchés. Règle identique au backfill SQL.
 * Le titre est borné à 200 caractères (colonne VarChar(200)) : le slug final
 * reste sous la limite de la colonne slug VarChar(220), pas de troncature.
 */
export function slugifierTitre(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Slug complet d'une offre : titre vide → « offre-<id> » (comme le SQL). */
export function construireSlugOffre(titre: string, id: number): string {
  return `${slugifierTitre(titre) || 'offre'}-${id}`
}

/** Vrai si la chaîne est un slug d'offre attendu (garde-fou des 404). */
export function estSlugOffreValide(slug: string): boolean {
  return SLUG_OFFRE_REGEX.test(slug)
}
