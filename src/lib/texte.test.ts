import { describe, expect, it } from 'vitest'

import { texteSansBalises } from './texte'

// ─── Tests du retrait de balises (M6, décision D13(b)) ──────────────────────
// Verrouillent la sémantique EXACTE : retrait des séquences `<…>` COMPLÈTES,
// `<` orphelin conservé (« 5 < 7 »), aucun décodage d'entité, aucun dégât
// collatéral sur le texte ni sur les espaces.
// ---------------------------------------------------------------------------

describe('texteSansBalises — cas d’attaque', () => {
  it('retire un <script> complet en deux matches', () => {
    expect(texteSansBalises('<script>alert(1)</script>')).toBe('alert(1)')
  })

  it('retire une balise autofermée, sans rien laisser derrière', () => {
    expect(texteSansBalises('<img src=x onerror=alert(1)>')).toBe('')
  })

  it('retire la balise ouvrante même non fermée', () => {
    expect(texteSansBalises('<b>texte')).toBe('texte')
    expect(texteSansBalises('<b>texte</b>')).toBe('texte')
  })

  it('retire une balise s’étendant sur plusieurs lignes', () => {
    expect(texteSansBalises('avant\n<script\n  type="module"\n>alert(1)</script>\naprès')).toBe(
      'avant\nalert(1)\naprès',
    )
  })
})

describe('texteSansBalises — ce qu’il ne doit JAMAIS faire', () => {
  it('conserve le < final de « 5 < 7 »', () => {
    expect(texteSansBalises('5 < 7')).toBe('5 < 7')
    expect(texteSansBalises('5 <')).toBe('5 <')
    expect(texteSansBalises('salaire_min < salaire_max ?')).toBe(
      'salaire_min < salaire_max ?',
    )
  })

  it('ne décode aucune entité HTML', () => {
    expect(texteSansBalises('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(texteSansBalises('Tom &amp; Jerry')).toBe('Tom &amp; Jerry')
  })

  it('ne touche pas à une chaîne sans balise', () => {
    const texte = 'Développeur Web Full Stack — CDI à Douala’'
    expect(texteSansBalises(texte)).toBe(texte)
  })

  it('rend une chaîne vide pour une entrée vide', () => {
    expect(texteSansBalises('')).toBe('')
  })
})

describe('texteSansBalises — ni dégât collatéral ni normalisation', () => {
  it('retire les balises en laissant le texte entier', () => {
    expect(texteSansBalises('<p>L’offre <b>CDI</b> à Douala</p>')).toBe(
      'L’offre CDI à Douala',
    )
    expect(texteSansBalises('a<b>b</b>c')).toBe('abc')
  })

  it('conserve un > orphelin : rien à retirer, et il n’ouvre aucune balise', () => {
    expect(texteSansBalises('5 > 7')).toBe('5 > 7')
    expect(texteSansBalises('<b>ok</b> > suite')).toBe('ok > suite')
  })

  it('ne réorganise aucun espace autour des balises retirées', () => {
    // Les deux espaces d’origine (avant/après la balise) subsistent :
    // seul le balisage disparaît.
    expect(texteSansBalises('début <i></i> fin')).toBe('début  fin')
    expect(texteSansBalises('  <b>  </b>  ')).toBe('      ')
  })

  it('est pure : même entrée, même sortie, sans effet de bord', () => {
    const entree = '<em>stylé</em> et ’ ’'
    expect(texteSansBalises(entree)).toBe(texteSansBalises(entree))
    expect(texteSansBalises(entree)).toBe('stylé et ’ ’')
  })
})
