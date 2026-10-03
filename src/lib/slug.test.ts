import { describe, expect, it } from 'vitest'

import {
  SLUG_OFFRE_REGEX,
  construireSlugOffre,
  estSlugOffreValide,
  slugifierTitre,
} from './slug'

// ─── Tests des slugs d'URL publique (M5, task 4) ─────────────────────────────
// Verrouillent la règle partagée avec le backfill SQL de la migration
// 20261003164500 : divergence des deux côtés = URL différentes entre la
// base remplie et les futures créations M6.
// ---------------------------------------------------------------------------

describe('slugifierTitre', () => {
  it('retire les accents et remplace les espaces par des tirets', () => {
    expect(slugifierTitre('Développeur back-end')).toBe('developpeur-back-end')
    expect(slugifierTitre('Technicien support informatique')).toBe(
      'technicien-support-informatique',
    )
  })

  it('gère apostrophes, ponctuation et majuscules', () => {
    expect(slugifierTitre("Ingénieur d'essais (H/F) !")).toBe(
      'ingenieur-d-essais-h-f',
    )
    expect(slugifierTitre('  --Déjà ÉCRI  --')).toBe('deja-ecri')
  })

  it('transcrit les ligatures françaises comme le backfill SQL', () => {
    expect(slugifierTitre('Cœur de cible')).toBe('coeur-de-cible')
    expect(slugifierTitre('Curriculum vitæ')).toBe('curriculum-vitae')
    expect(slugifierTitre('L’année de l’apprenti')).toBe(
      'l-annee-de-l-apprenti',
    )
  })

  it('renvoie une chaîne vide pour un titre sans aucun caractère valide', () => {
    expect(slugifierTitre('?!')).toBe('')
    expect(slugifierTitre('   ')).toBe('')
  })
})

describe('construireSlugOffre', () => {
  it('suffixe l’id, ce qui rend le slug unique même à titre égal', () => {
    expect(construireSlugOffre('Développeur PHP', 5)).toBe('developpeur-php-5')
    expect(construireSlugOffre('Développeur PHP', 6)).toBe('developpeur-php-6')
  })

  it('tombe sur « offre-<id> » quand le titre n’apporte rien (comme le SQL)', () => {
    expect(construireSlugOffre('!!!', 42)).toBe('offre-42')
    expect(construireSlugOffre('', 7)).toBe('offre-7')
  })

  it('reste sous la limite VarChar(220) pour un titre maximal (200 car.)', () => {
    const slug = construireSlugOffre('a'.repeat(200), 1234567890)
    expect(slug).toHaveLength(211)
    expect(slug).toBe(`${'a'.repeat(200)}-1234567890`)
  })
})

describe('estSlugOffreValide / SLUG_OFFRE_REGEX', () => {
  it('accepte les slugs générés par le constructeur', () => {
    for (const [titre, id] of [
      ['Développeur back-end', 42],
      ['Intégrateur web', 1],
      ['PHP 8', 1003],
      ['!!!', 7],
      ['a', 9],
    ] as const) {
      const slug = construireSlugOffre(titre, id)
      expect(estSlugOffreValide(slug)).toBe(true)
      expect(SLUG_OFFRE_REGEX.test(slug)).toBe(true)
    }
  })

  it('rejette l’ancien format numérique legacy AVANT toute requête base', () => {
    expect(estSlugOffreValide('42')).toBe(false)
    expect(estSlugOffreValide('0')).toBe(false)
  })

  it('rejette tout slug qui n’a pas pu être généré par nos règles', () => {
    for (const invalide of [
      'Developpeur-1', // majuscule
      '-developpeur-1', // tiret en tête
      'developpeur-1-', // tiret en queue
      'developpeur--php-5', // double tiret
      'developpeur-php-0', // id nul
      'developpeur-php-01', // id à zéro initial
      'developpeur_php-1', // underscore
      'développeur-1', // accentué
      'developpeur-php', // sans suffixe d’id
      '',
    ]) {
      expect(estSlugOffreValide(invalide)).toBe(false)
    }
  })
})
