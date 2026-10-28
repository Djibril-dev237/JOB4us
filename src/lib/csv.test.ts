import { describe, expect, it } from 'vitest'

import { celluleCsv, construireCsv } from './csv'

describe('celluleCsv', () => {
  it('neutralise les formules et les valeurs de tête dangereuses', () => {
    expect(celluleCsv('=1+1')).toBe("'=1+1")
    expect(celluleCsv('+42')).toBe("'+42")
    expect(celluleCsv('-42')).toBe("'-42")
    expect(celluleCsv('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(celluleCsv('\tvaleur')).toBe("'\tvaleur")
    expect(celluleCsv('  =1+1')).toBe("'  =1+1")
  })

  it('laisse le texte ordinaire intact', () => {
    expect(celluleCsv('Bonjour')).toBe('Bonjour')
    expect(celluleCsv(42)).toBe('42')
    expect(celluleCsv(null)).toBe('')
    expect(celluleCsv(undefined)).toBe('')
  })

  it('applique le quoting RFC 4180', () => {
    expect(celluleCsv('a,b')).toBe('"a,b"')
    expect(celluleCsv('il a dit "oui"')).toBe('"il a dit ""oui"""')
    expect(celluleCsv('ligne1\nligne2')).toBe('"ligne1\nligne2"')
    expect(celluleCsv('ligne1\r\nligne2')).toBe('"ligne1\r\nligne2"')
  })

  it('formate les dates en ISO et retire les octets nuls', () => {
    expect(celluleCsv(new Date('2026-10-28T12:00:00.000Z'))).toBe(
      '2026-10-28T12:00:00.000Z',
    )
    expect(celluleCsv('a\u0000b')).toBe('ab')
  })
})

describe('construireCsv', () => {
  it('ajoute le BOM par défaut et termine par CRLF', () => {
    const csv = construireCsv(['a', 'b'], [[1, 'x']])
    expect(csv).toBe('\uFEFFa,b\r\n1,x\r\n')
  })

  it('peut omettre le BOM', () => {
    expect(construireCsv(['a'], [['x']], { bom: false })).toBe('a\r\nx\r\n')
  })

  it('protège chaque cellule, y compris les en-têtes', () => {
    const csv = construireCsv(['=nom', 'note'], [['@ici', 'a,b']], { bom: false })
    expect(csv).toBe("'=nom,note\r\n'@ici,\"a,b\"\r\n")
  })
})
