// ─── Affichage partagé des écrans de modération (/admin/signalements) ────────
// Composants LOCAUX au dossier admin : aucune date ni extrait n'est recopié
// entre la liste et le détail, et rien ne sort de ce dossier.
//
// Dates : `Intl` fr-FR FIGÉ sur `Africa/Douala` (motif M6 repris à
// l'identique de admin/offres/ligne-offre.tsx et de la messagerie) — un
// formateur local serait non partageable sans toucher à un fichier hors
// mission, et formater dans le fuseur du serveur décalerait d'un jour aux
// bornes de minuit.
// ---------------------------------------------------------------------------

/** Date courte « JJ/MM/AAAA » (fuseau de la cible). */
export const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** Date + heure « JJ/MM/AAAA HH:MM » (traitement d’un signalement). */
export const FORMATEUR_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Extrait de lecture tronqué à `max` POINTS DE CODE (jamais au milieu d'une
 * paire de surrogates : `Array.from` segmente par caractère entier), avec
 * point de suspension. Le texte reste du texte brut — l'affichage est
 * échappé par React, aucun retrait de balise côté affichage (motif M8).
 */
export function extrait(texte: string, max: number): string {
  const points = Array.from(texte)
  if (points.length <= max) {
    return texte
  }
  return `${points.slice(0, max).join('').trimEnd()}…`
}
