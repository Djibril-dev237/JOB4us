import { texteSansBalises } from '@/lib/texte'

// ─── Nettoyage du contenu de messagerie (M8, Vague 1) ────────────────────────
//
// RÔLE : garantir qu'aucun message ou motif signalé n'est stocké avec du
// contenu « dangereux ou corrompu » — balises, caractères de contrôle,
// zéro-largeur, flood de sauts de ligne, texte interminable. La couche
// d'affichage (React) échappe déjà toute chaîne interpolée : le retrait de
// balises ici n'est PAS la ligne de défense XSS, c'est la garantie que la
// BASE ne contient jamais de balisage, quel que soit le chemin d'écriture
// (formulaire, action serveur, appel direct). On RÉUTILISE la sémantique
// M6 (`texteSansBalises`, D13(b)) : une seule règle de retrait dans tout le
// projet, impossible à voir diverger.
//
// PIPELINE ORDONNÉ — chaque étape suppose la précédente déjà appliquée :
//  1. retrait des balises d'abord : c'est la propriété la plus importante,
//     et la suivante (contrôle) ne peut pas la fabriquer — aucun ordre
//     inverse n'est sûr ;
//  2. suppression des caractères de contrôle (U+0000–U+0008, U+000B,
//     U+000C, U+000E–U+001F, U+007F) et des zéro-largeur (U+200B–U+200D,
//     U+FEFF) : ils corrompent l'affichage (retour de curseur, octets
//     fantômes) et faussent tout comptage de longueur puisqu'ils sont
//     invisibles. `\n` (U+000A) et `\t` (U+0009) sont une mise en forme
//     légitime d'un message multi-lignes : on les CONSERVE ;
//  3. bornage des suites de `\n` à 2 : un mur de retours à la ligne sert
//     uniquement à faire déborder le fil de discussion ;
//  4. trim : après nettoyage, les espaces résiduels ne sont pas du contenu
//     («   » n'est pas un message) — fait APRÈS le bornage pour ne pas
//     réintroduire des `\n` en fin de chaîne à chaque passe ;
//  5. troncature EN POINTS DE CODE : UTF-16 indexe sur des code units, une
//     coupe à 2000 « caractères » peut tomber au milieu d'une paire de
//     surrogates (emoji) et laisser un caractère orphelin affiché en
//     remplacement. `Array.from` segmente en points de code : la coupe est
//     toujours propre, jamais au milieu d'un caractère.
//
// Deux bornes distinctes : `LONGUEUR_MAX_MESSAGE`/`LONGUEUR_MAX_MOTIF` sont
// la cible RÉELLE après nettoyage (ce que l'utilisateur voit en base) ;
// `GARDE_LONGUEUR_BRUT` vit dans messagerie-schemas.ts et rejette le payload
// AVANT nettoyage — voir l'en-tête de ce fichier pour les deux temps.
//
// Fonctions PURES : ni effet de bord, ni exception (String.prototype.replace
// et Array.from ne lèvent jamais sur une chaîne).
// ---------------------------------------------------------------------------

/** Longueur réelle d'un message APRÈS nettoyage (points de code). */
export const LONGUEUR_MAX_MESSAGE = 2000

/** Longueur réelle d'un motif de signalement APRÈS nettoyage. */
export const LONGUEUR_MAX_MOTIF = 300

/** Garde de longueur BRUTE, appliquée par les schémas AVANT nettoyage. */
export const GARDE_LONGUEUR_BRUT = 8000

// Caractères de contrôle (hors `\t`, `\n` et `\r` — conservés : la saisie
// d'un navigateur envoie `\r\n`, détruire le `\r` déformerait le texte sans
// le moindre gain de sécurité, et il est inert une fois échappé par React)
// et zéro-largeur : retirés en une seule passe, après le retrait de balises.
//
// Les plages sont décrites en points de code et assemblées à l'exécution :
// les écrire comme échappements dans la source insérerait de VRAIS octets
// de contrôle dans le fichier (illisible, et tronqué par certains outils) —
// nommer les bornes garde la source ASCII pure et la relecture directe.
const CONTROLES_ET_ZERO_LARGEUR = new RegExp(
  `[${[
    [0x0000, 0x0008],
    [0x000b, 0x000c],
    [0x000e, 0x001f],
    [0x007f, 0x007f],
    [0x200b, 0x200d],
    [0xfeff, 0xfeff],
  ]
    .map(([debut, fin]) =>
      debut === fin
        ? String.fromCharCode(debut)
        : `${String.fromCharCode(debut)}-${String.fromCharCode(fin)}`,
    )
    .join('')}]`,
  'g',
)

// Trois `\n` ou plus ne sont jamais de la mise en forme légitime : on garde
// une seule « double saut de ligne ».
const SUITES_DE_RETOURS = /\n{3,}/g

/**
 * Tronque à `max` POINTS DE CODE, en coupant toujours entre deux
 * caractères entiers (aucune paire de surrogates n'est jamais divisée).
 *
 * @param texte texte déjà nettoyé
 * @param max nombre maximal de points de code à conserver
 */
function tronquerEnPointsDeCode(texte: string, max: number): string {
  // `Array.from` segmente par point de code : un emoji (paire de surrogates)
  // occupe UN seul élément, donc `slice` ne peut pas couper en son milieu.
  const pointsDeCode = Array.from(texte)
  if (pointsDeCode.length <= max) {
    return texte
  }
  return pointsDeCode.slice(0, max).join('')
}

/**
 * Pipeline complet de nettoyage, commun aux deux types de contenu.
 *
 * @param brut texte saisi par l'utilisateur
 * @param longueurMax borne finale en points de code
 */
function nettoyer(brut: string, longueurMax: number): string {
  const sansBalises = texteSansBalises(brut)
  const sansControles = sansBalises.replace(CONTROLES_ET_ZERO_LARGEUR, '')
  const borne = sansControles.replace(SUITES_DE_RETOURS, '\n\n')
  return tronquerEnPointsDeCode(borne.trim(), longueurMax)
}

/**
 * Nettoie le contenu d'un message de conversation.
 *
 * @param brut contenu tel que soumis par le client
 * @returns texte inert (sans balise), sans caractère de contrôle, borné et
 *          tronqué à `LONGUEUR_MAX_MESSAGE` points de code
 */
export function nettoyerMessage(brut: string): string {
  return nettoyer(brut, LONGUEUR_MAX_MESSAGE)
}

/**
 * Nettoie le motif d'un signalement de message.
 *
 * @param brut motif tel que soumis par le client
 * @returns même pipeline que {@link nettoyerMessage}, tronqué à
 *          `LONGUEUR_MAX_MOTIF` points de code
 */
export function nettoyerMotif(brut: string): string {
  return nettoyer(brut, LONGUEUR_MAX_MOTIF)
}