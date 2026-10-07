// ─── Retrait de balises côté serveur (M6, décision D13(b)) ──────────────────
//
// RÔLE : couche en profondeur. Le rendu React échappe déjà toute chaîne
// interpolée (aucun `dangerouslySetInnerHTML` dans le projet) : cette
// fonction n'est donc PAS la première ligne de défense, elle garantit qu'aucune
// balise n'est JAMAIS stockée en base, quel que soit le chemin d'écriture
// (formulaire recruteur, import, appel d'API direct).
//
// ZÉRO dépendance externe : ni parseur HTML, ni DOMPurify. La règle est
// délibérément mécanique, vérifiable ligne à ligne, et ne dépend d'aucun
// correctif de sécurité tiers à maintenir.
//
// SÉMANTIQUE EXACTE :
// - `<[^>]*>` correspond à une balise ouvrée + tout son contenu interne
//   jusqu'au premier `>` : `<script>alert(1)</script>` disparaît en DEUX
//   matches (ouvrante, puis fermante) et laisse `alert(1)` en texte inert.
//   Un `>` posé DANS un attribut guillemeté coupe la balise trop tôt
//   (`<a title=">">x` → `">x`) : un résidu survit, mais inerte — retirer
//   ne peut JAMAIS fabriquer un `<` (le seul caractère qui créerait une
//   balise) et React échappe le résidu à l'affichage. La garantie porte sur
//   l'absence de `<` produit, pas sur la disparition de tout déchet.
// - un `<` SANS `>` correspondant est LAISSÉ tel quel : « 5 < 7 » conserve sa
//   fin. Ce `<` orphelin est inert une fois échappé par React (il devient du
//   texte), aucun navigateur ne peut le réinterpréter : tronquer la chaîne
//   détruirait un contenu légitime pour un gain de sécurité nul.
// - AUCUN décodage d'entité HTML : `&lt;script&gt;` reste littéralement
//   `&lt;script&gt;`. Décoder reviendrait à fabriquer la balise qu'on
//   cherchait à retirer (le décodage appartient au moment de l'affichage).
// - AUCUNE normalisation d'espaces : seuls les caractères de balises sont
//   retirés, la mise en forme d'origine est préservée.
// - Fonction PURE : ni effet de bord, ni état, ni exception possible sur une
//   chaîne (String.prototype.replace ne lève jamais).

/**
 * Retire toutes les balises HTML d'une chaîne.
 *
 * @param valeur texte saisi par l'utilisateur (déjà converti en string)
 * @returns la chaîne sans aucune séquence `<…>` complète, sinon identique
 */
export function texteSansBalises(valeur: string): string {
  return valeur.replace(/<[^>]*>/g, '')
}
