// ─── Export CSV sûr (M10) ────────────────────────────────────────────────────
//
// Fonctions PURES, testables sans base. Deux protections sont verrouillées :
//  * injection de formule : une cellule commençant par =, +, -, @, tabulation
//    ou retour chariot (même après des espaces de tête) est préfixée d'une
//    apostrophe. Excel/Calc l'affiche comme du texte, pas comme une formule ;
//  * RFC 4180 : guillemets doublés, cellules contenant virgule, guillemet,
//    CR ou LF entourées de guillemets, lignes terminées par CRLF.
//
// Le BOM UTF-8 est ajouté par défaut pour qu'Excel reconnaisse les accents.
// Aucune donnée n'est transformée silencieusement en HTML.
// ---------------------------------------------------------------------------

export interface OptionsCsv {
  /** Ajoute le BOM UTF-8 en tête (défaut : true). */
  bom?: boolean
}

function texteCellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return ''
  if (valeur instanceof Date) return valeur.toISOString()
  return String(valeur).replace(/\u0000/g, '')
}

function estFormuleDangereuse(texte: string): boolean {
  // Excel ignore parfois les espaces de tête avant d'interpréter une formule.
  return /^[=+\-@\t\r]/.test(texte) || /^\s+[=+\-@]/.test(texte)
}

/**
 * Rend une cellule CSV. Ne lève jamais : un objet inconnu devient sa chaîne.
 * Une valeur dangereuse est neutralisée AVANT le quoting, pour que
 * l'apostrophe soit elle aussi correctement échappée.
 */
export function celluleCsv(valeur: unknown): string {
  let texte = texteCellule(valeur)
  if (estFormuleDangereuse(texte)) texte = `'${texte}`
  if (/[",\r\n]/.test(texte)) {
    return `"${texte.replace(/"/g, '""')}"`
  }
  return texte
}

/**
 * Construit un CSV complet. `entetes` et chaque ligne sont rendus cellule par
 * cellule ; le nombre de colonnes n'est pas imposé ici (l'appelant décide de
 * son schéma et de la taille maximale de l'export).
 */
export function construireCsv(
  entetes: readonly unknown[],
  lignes: readonly (readonly unknown[])[],
  options: OptionsCsv = {},
): string {
  const contenu = [entetes, ...lignes]
    .map((ligne) => ligne.map(celluleCsv).join(','))
    .join('\r\n')
  const avecFin = `${contenu}\r\n`
  return options.bom === false ? avecFin : `\uFEFF${avecFin}`
}
