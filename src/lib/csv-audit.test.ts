import { describe, expect, it } from 'vitest'

import type { LigneJournalAudit } from './journal-audit'

import { celluleCsv, construireCsvAudit, protegerCelluleCsv } from './csv-audit'

// ─── Export CSV d'audit (M10) ───────────────────────────────────────────────
// Le CSV doit rester ouvrable dans un tableur sans exécuter une formule
// hostile : toute cellule commençant par = + - @ ou un contrôle est préfixée.
// Les guillemets sont doublés et les cellules toujours citées.
// ---------------------------------------------------------------------------

function ligne(overrides: Partial<LigneJournalAudit> = {}): LigneJournalAudit {
  return {
    source: 'generique',
    entreeId: 1,
    acteurId: 42,
    acteurNom: 'Admin Test',
    action: 'suspension_utilisateur',
    cibleType: 'utilisateur',
    cibleId: 7,
    motif: 'comportement',
    commentaire: 'Note interne',
    createdAt: new Date('2026-10-15T10:00:00.000Z'),
    ...overrides,
  }
}

describe('protegerCelluleCsv', () => {
  it.each(['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1:A2)', '\t=cmd', '\r=cmd'])(
    'neutralise la formule %s',
    (valeur) => {
      expect(protegerCelluleCsv(valeur)).toBe(`'${valeur}`)
    },
  )

  it('laisse intact un texte ordinaire', () => {
    expect(protegerCelluleCsv('Note interne')).toBe('Note interne')
  })
})

describe('celluleCsv', () => {
  it('double les guillemets et cite toujours la cellule', () => {
    expect(celluleCsv('Il a dit "stop"')).toBe('"Il a dit ""stop"""')
  })

  it('rend une cellule vide pour null ou undefined', () => {
    expect(celluleCsv(null)).toBe('""')
    expect(celluleCsv(undefined)).toBe('""')
  })
})

describe('construireCsvAudit', () => {
  it('produit un BOM, un en-tête et une ligne par entrée', () => {
    const csv = construireCsvAudit([ligne()])

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(
      '"source";"entree_id";"acteur_id";"acteur_nom";"action";"cible_type";"cible_id";"motif";"commentaire";"created_at"',
    )
    expect(csv).toContain(
      '"generique";"1";"42";"Admin Test";"suspension_utilisateur";"utilisateur";"7";"comportement";"Note interne";"2026-10-15T10:00:00.000Z"',
    )
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('neutralise une formule dans une note libre', () => {
    const csv = construireCsvAudit([
      ligne({ commentaire: '=HYPERLINK("http://exemple.test")' }),
    ])

    expect(csv).toContain(`"'=HYPERLINK(""http://exemple.test"")"`)
    expect(csv).not.toContain(`"=HYPERLINK`)
  })

  it('ne confond pas un tiret de texte avec une formule', () => {
    const csv = construireCsvAudit([ligne({ commentaire: 'Compte suspendu - recours' })])

    expect(csv).toContain('"Compte suspendu - recours"')
  })
})
