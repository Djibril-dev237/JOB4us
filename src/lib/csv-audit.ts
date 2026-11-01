import type { LigneJournalAudit } from '@/lib/journal-audit'

// ─── Export CSV du journal d'audit (M10) ────────────────────────────────────
// Deux protections distinctes :
//  * neutralisation de l'injection de formule (Excel/LibreOffice) : toute
//    cellule commençant par = + - @ ou un caractère de contrôle est préfixée
//    par une apostrophe ;
//  * échappement CSV standard : guillemets doublés, cellule toujours citée.
// Le BOM permet à Excel de reconnaître l'UTF-8 sans configuration.
// ---------------------------------------------------------------------------

const DEBUT_DANGEREUX = /^[=+\-@\t\r]/

export function protegerCelluleCsv(valeur: string): string {
  return DEBUT_DANGEREUX.test(valeur) ? `'${valeur}` : valeur
}

export function celluleCsv(valeur: string | number | null | undefined): string {
  const texte = valeur === null || valeur === undefined ? '' : String(valeur)
  return `"${protegerCelluleCsv(texte).replaceAll('"', '""')}"`
}

export function construireCsvAudit(lignes: LigneJournalAudit[]): string {
  const entetes = [
    'source',
    'entree_id',
    'acteur_id',
    'acteur_nom',
    'action',
    'cible_type',
    'cible_id',
    'motif',
    'commentaire',
    'created_at',
  ]
  const lignesCsv = lignes.map((ligne) =>
    [
      celluleCsv(ligne.source),
      celluleCsv(ligne.entreeId),
      celluleCsv(ligne.acteurId),
      celluleCsv(ligne.acteurNom),
      celluleCsv(ligne.action),
      celluleCsv(ligne.cibleType),
      celluleCsv(ligne.cibleId),
      celluleCsv(ligne.motif),
      celluleCsv(ligne.commentaire),
      celluleCsv(ligne.createdAt.toISOString()),
    ].join(';'),
  )

  return `\uFEFF${entetes.map(celluleCsv).join(';')}\r\n${lignesCsv.join('\r\n')}\r\n`
}
