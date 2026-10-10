import { describe, expect, it } from 'vitest'

import {
  GARDE_LONGUEUR_BRUT,
  LONGUEUR_MAX_MOTIF,
  LONGUEUR_MAX_MESSAGE,
  nettoyerMessage,
  nettoyerMotif,
} from './messagerie-contenu'

// ─── Tests du nettoyage de contenu (M8, Vague 1) ─────────────────────────────
// Verrouillent le pipeline ORDONNÉ : retrait de balises (sémantique M6,
// D13(b)), retrait des caractères de contrôle et zéro-largeur en conservant
// `\n`/`\t`, bornage des doubles retours, trim, troncature en POINTS DE CODE
// qui ne coupe JAMAIS une paire de surrogates.
// ---------------------------------------------------------------------------

// Caractères illégitimes construits à l'exécution : écrire leurs échappements
// dans la source insérerait de vrais octets de contrôle dans le fichier.
const NUL = String.fromCharCode(0x0000)
const BEL = String.fromCharCode(0x0007)
const SO = String.fromCharCode(0x000e) // Shift Out, haut de la plage U+000E–U+001F
const US = String.fromCharCode(0x1f) // Unit Separator, bas de la plage
const DEL = String.fromCharCode(0x007f)
const ZWSP = String.fromCharCode(0x200b) // espace zéro-largeur
const ZWNJ = String.fromCharCode(0x200c)
const ZWJ = String.fromCharCode(0x200d)
const BOM = String.fromCharCode(0xfeff)

describe('nettoyerMessage — caractères de contrôle et zéro-largeur', () => {
  it('retire les contrôles mais conserve \\t, \\n et \\r (saisie navigateur)', () => {
    // `\r` verrouillé ici à dessein : les textareas envoient `\r\n`, le
    // conserver est une décision explicite (voir messagerie-contenu.ts).
    expect(nettoyerMessage(`avant${NUL}mid${BEL}le${SO}${US}fin\tcol1\r\ncol2${DEL}`)).toBe(
      'avantmidlefin\tcol1\r\ncol2',
    )
  })

  it('retire les quatre zéro-largeur sans toucher au texte voisin', () => {
    expect(nettoyerMessage(`bon${ZWSP}jour${ZWNJ}${ZWJ} ca va${BOM} ?`)).toBe(
      'bonjour ca va ?',
    )
  })

  it('est pure : une chaîne propre revient identique', () => {
    const texte = 'Bonjour, ça va ?\nOui merci\t!'
    expect(nettoyerMessage(texte)).toBe(texte)
  })
})

describe('nettoyerMessage — suites de retours et trim', () => {
  it('borne les suites de \\n à 2, sans compter les simples', () => {
    expect(nettoyerMessage('a\n\n\n\n\nb')).toBe('a\n\nb')
    expect(nettoyerMessage('a\n\nb')).toBe('a\n\nb')
    expect(nettoyerMessage('a\nb')).toBe('a\nb')
  })

  it('trime les espaces de tête et de queue, \\t et \\n internes compris', () => {
    expect(nettoyerMessage('   \n\n  bonjour  \t\n ')).toBe('bonjour')
    expect(nettoyerMessage('\n\n\n')).toBe('')
  })
})

describe('nettoyerMessage — troncature en points de code', () => {
  it('tronque exactement à 2000 points de code ASCII', () => {
    const sortie = nettoyerMessage('a'.repeat(LONGUEUR_MAX_MESSAGE + 500))
    expect(sortie).toBe('a'.repeat(LONGUEUR_MAX_MESSAGE))
  })

  it('ne coupe JAMAIS une paire de surrogates : emoji en position 2000', () => {
    // L'emoji occupe le 2000e point de code : il doit être conservé ENTIER,
    // jamais réduit à son haut surrogate orphelin.
    const sortie = nettoyerMessage(`${'a'.repeat(1999)}😀suite`)
    expect(sortie).toBe(`${'a'.repeat(1999)}😀`)
    expect([...sortie]).toHaveLength(LONGUEUR_MAX_MESSAGE)
  })

  it('exclut entièrement un emoji qui déborde de la coupe', () => {
    // Le 2e emoji commencerait au point de code 2001 : il tombe ENTIER hors
    // borne, la chaîne s'arrête proprement sur « a ».
    expect(nettoyerMessage(`${'a'.repeat(1999)}😀😀`)).toBe(`${'a'.repeat(1999)}😀`)
  })

  it('reste bien formée sur une succession d’emoji tronquée', () => {
    // 2500 emoji = 2500 points de code (chaque emoji vaut 2 code units
    // UTF-16 mais UN point de code) : coupe à 2000 emoji, aucun orphelin.
    const sortie = nettoyerMessage('😀'.repeat(2500))
    expect(sortie).toBe('😀'.repeat(LONGUEUR_MAX_MESSAGE))
    expect(sortie.isWellFormed()).toBe(true)
  })
})

describe('nettoyerMessage — retrait de balises (sémantique M6)', () => {
  it('retire <script> et laisse le texte inert', () => {
    expect(nettoyerMessage('<script>alert(1)</script>')).toBe('alert(1)')
  })

  it('conserve un < orphelin tel quel (« 5 < 7 »)', () => {
    expect(nettoyerMessage('5 < 7')).toBe('5 < 7')
  })

  it('applique le retrait de balises AVANT le reste du pipeline', () => {
    // La balise part entière (y compris son attribut porteur de contrôles) :
    // si le retrait de contrôle passait en premier, la balise serait
    // déchirée et une moitié survivrait.
    expect(nettoyerMessage(`<b title="${BEL}">ok</b>`)).toBe('ok')
  })
})

describe('nettoyerMotif — même pipeline, borne propre', () => {
  it('applique toutes les étapes du pipeline de message', () => {
    expect(nettoyerMessage(`<i>${NUL}</i>motif\n\n\nsignificatif${ZWSP}`)).toBe(
      nettoyerMotif(`<i>${NUL}</i>motif\n\n\nsignificatif${ZWSP}`),
    )
    expect(nettoyerMotif(`<i>${NUL}</i>motif\n\n\nsignificatif${ZWSP}`)).toBe(
      'motif\n\nsignificatif',
    )
  })

  it('tronque à 300 points de code, pas à la borne de message', () => {
    const sortie = nettoyerMotif('m'.repeat(400))
    expect(sortie).toBe('m'.repeat(LONGUEUR_MAX_MOTIF))
    expect(nettoyerMotif('m'.repeat(LONGUEUR_MAX_MOTIF))).toBe('m'.repeat(LONGUEUR_MAX_MOTIF))
  })
})

describe('bornes exportées — contrat de la spec M8', () => {
  it('garde la cible brute strictement supérieure aux cibles réelles', () => {
    // Les deux temps (rejet du brut, troncature après nettoyage) n'ont de
    // sens que si la garde laisse de la place au nettoyage.
    expect(GARDE_LONGUEUR_BRUT).toBe(8000)
    expect(LONGUEUR_MAX_MESSAGE).toBe(2000)
    expect(LONGUEUR_MAX_MOTIF).toBe(300)
    expect(GARDE_LONGUEUR_BRUT).toBeGreaterThan(LONGUEUR_MAX_MESSAGE)
    expect(LONGUEUR_MAX_MESSAGE).toBeGreaterThan(LONGUEUR_MAX_MOTIF)
  })
})
