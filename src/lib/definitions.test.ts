import { NiveauExperience, TypeContrat } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  NIVEAU_EXPERIENCE_LABELS,
  NIVEAU_EXPERIENCE_VALUES,
  OffresQuerySchema,
  TYPE_CONTRAT_LABELS,
  TYPE_CONTRAT_VALUES,
} from './definitions'

// ─── Tests du schéma d’URL /offres (M5, task 3) ──────────────────────────────
// Verrouillent : noms de paramètres legacy, coercitions, « invalide = ignoré
// (jamais d’erreur) », bornes de longueur, strip des clés inconnues, et
// l’égalité des tuples de valeurs avec les enums Prisma (anti-divergence).
// ---------------------------------------------------------------------------

describe('OffresQuerySchema — URL complète', () => {
  it('lit les 6 paramètres legacy avec coercitions numériques', () => {
    const resultat = OffresQuerySchema.safeParse({
      q: 'développeur',
      ville: 'Douala',
      categorie: '3',
      type_contrat: 'stage',
      niveau: 'junior',
      page: '2',
    })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      q: 'développeur',
      ville: 'Douala',
      categorie: 3,
      type_contrat: 'stage',
      niveau: 'junior',
      page: 2,
    })
  })

  it('ignore les clés inconnues (utm_source, fbclid…)', () => {
    const resultat = OffresQuerySchema.safeParse({
      q: 'dev',
      utm_source: 'newsletter',
      fbclid: '123',
    })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      q: 'dev',
      ville: undefined,
      categorie: undefined,
      type_contrat: undefined,
      niveau: undefined,
      page: undefined,
    })
  })
})

describe('OffresQuerySchema — invalidité = paramètre ignoré', () => {
  it('une racine non objet fait échouer le parse (repli error.tsx)', () => {
    expect(() => OffresQuerySchema.parse(null)).toThrow()
    expect(() => OffresQuerySchema.parse('page=2')).toThrow()
  })

  it('vide ou en blanc → champ ignoré (trim AVANT min)', () => {
    const resultat = OffresQuerySchema.parse({ q: '   ', ville: '' })

    expect(resultat.q).toBeUndefined()
    expect(resultat.ville).toBeUndefined()
  })

  it('applique le trim aux valeurs exploitables', () => {
    expect(OffresQuerySchema.parse({ q: '  back-end  ' }).q).toBe('back-end')
    expect(OffresQuerySchema.parse({ ville: ' Douala ' }).ville).toBe('Douala')
  })

  it('valeurs hors enum → ignorées, jamais une erreur', () => {
    const resultat = OffresQuerySchema.parse({
      type_contrat: 'CDI3',
      niveau: 'rockstar',
      categorie: '999abc',
    })

    expect(resultat.type_contrat).toBeUndefined()
    expect(resultat.niveau).toBeUndefined()
    expect(resultat.categorie).toBeUndefined()
  })

  it('page invalide → 1 (clamp), page absente → undefined, page valide → conservée', () => {
    expect(OffresQuerySchema.parse({ page: '-4' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '0' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '2.5' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: 'abc' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '12' }).page).toBe(12)
    expect(OffresQuerySchema.parse({}).page).toBeUndefined()
  })

  it('paramètre répété (string[]) → ignoré sauf coercion mono-élément', () => {
    const resultat = OffresQuerySchema.parse({
      q: ['a', 'b'],
      categorie: ['1', '2'],
      page: ['3', '4'],
    })

    expect(resultat.q).toBeUndefined()
    expect(resultat.categorie).toBeUndefined()
    expect(resultat.page).toBe(1)
  })
})

describe('OffresQuerySchema — bornes defensives', () => {
  it('q au-delà de 200 caractères et ville au-delà de 100 → ignorés', () => {
    const resultat = OffresQuerySchema.parse({
      q: 'a'.repeat(201),
      ville: 'b'.repeat(101),
    })

    expect(resultat.q).toBeUndefined()
    expect(resultat.ville).toBeUndefined()
  })

  it('q à 200 et ville à 100 caractères → acceptés', () => {
    expect(OffresQuerySchema.parse({ q: 'a'.repeat(200) }).q).toHaveLength(200)
    expect(OffresQuerySchema.parse({ ville: 'b'.repeat(100) }).ville).toHaveLength(100)
  })
})

describe('valeurs de filtre vs enums Prisma', () => {
  it('TYPE_CONTRAT_VALUES couvre exactement l’enum Prisma', () => {
    expect([...TYPE_CONTRAT_VALUES].sort()).toEqual(Object.values(TypeContrat).sort())
  })

  it('NIVEAU_EXPERIENCE_VALUES couvre exactement l’enum Prisma', () => {
    expect([...NIVEAU_EXPERIENCE_VALUES].sort()).toEqual(
      Object.values(NiveauExperience).sort(),
    )
  })

  it('chaque valeur possède un libellé affichable', () => {
    expect(Object.keys(TYPE_CONTRAT_LABELS).sort()).toEqual(Object.values(TypeContrat).sort())
    expect(Object.keys(NIVEAU_EXPERIENCE_LABELS).sort()).toEqual(
      Object.values(NiveauExperience).sort(),
    )
    for (const libelle of [...Object.values(TYPE_CONTRAT_LABELS), ...Object.values(NIVEAU_EXPERIENCE_LABELS)]) {
      expect(libelle.trim()).not.toBe('')
      expect(libelle).not.toContain('_')
    }
  })

  it('les options d’URL correspondent aux valeurs du schema', () => {
    // Le schema et les tuples servent aux selects ET à la réécriture des
    // liens : diverger = lien de pagination qui filtre autrement que l’écran.
    for (const valeur of TYPE_CONTRAT_VALUES) {
      expect(OffresQuerySchema.parse({ type_contrat: valeur }).type_contrat).toBe(valeur)
    }
    for (const valeur of NIVEAU_EXPERIENCE_VALUES) {
      expect(OffresQuerySchema.parse({ niveau: valeur }).niveau).toBe(valeur)
    }
  })
})
