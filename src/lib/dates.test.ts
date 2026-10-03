import { describe, expect, it } from 'vitest'

import { dateRelativeFr } from './dates'

// ─── Tests de la date relative FR (M5, task 2) ───────────────────────────────
// Verrouille le mode numeric:'always' (« il y a 1 jour » et jamais « hier »),
// les seuils documentés et l'absence d'exception sur date invalide.
// ---------------------------------------------------------------------------

const MAINTENANT = new Date('2026-10-03T12:00:00Z')
const ilYa = (ms: number): Date => new Date(MAINTENANT.getTime() - ms)

const SECONDE = 1000
const MINUTE = 60 * SECONDE
const HEURE = 60 * MINUTE
const JOUR = 24 * HEURE

describe('dateRelativeFr', () => {
  it('affiche les secondes, sans jamais « il y a 0 seconde »', () => {
    expect(dateRelativeFr(ilYa(5 * SECONDE), MAINTENANT)).toBe('il y a 5 secondes')
    expect(dateRelativeFr(ilYa(0), MAINTENANT)).toBe('il y a 1 seconde')
    expect(dateRelativeFr(ilYa(200), MAINTENANT)).toBe('il y a 1 seconde')
  })

  it('passe aux minutes, heures puis jours aux bons seuils', () => {
    expect(dateRelativeFr(ilYa(3 * MINUTE), MAINTENANT)).toBe('il y a 3 minutes')
    expect(dateRelativeFr(ilYa(59 * MINUTE), MAINTENANT)).toBe('il y a 59 minutes')
    expect(dateRelativeFr(ilYa(2 * HEURE), MAINTENANT)).toBe('il y a 2 heures')
    expect(dateRelativeFr(ilYa(23 * HEURE), MAINTENANT)).toBe('il y a 23 heures')
    expect(dateRelativeFr(ilYa(3 * JOUR), MAINTENANT)).toBe('il y a 3 jours')
  })

  it('utilise numeric always : « il y a 1 jour » et non « hier »', () => {
    expect(dateRelativeFr(ilYa(JOUR), MAINTENANT)).toBe('il y a 1 jour')
    expect(dateRelativeFr(ilYa(29 * JOUR), MAINTENANT)).toBe('il y a 29 jours')
  })

  it('convertit en mois à 30 jours puis en années à 365', () => {
    expect(dateRelativeFr(ilYa(30 * JOUR), MAINTENANT)).toBe('il y a 1 mois')
    expect(dateRelativeFr(ilYa(95 * JOUR), MAINTENANT)).toBe('il y a 3 mois')
    expect(dateRelativeFr(ilYa(400 * JOUR), MAINTENANT)).toBe('il y a 1 an')
    expect(dateRelativeFr(ilYa(800 * JOUR), MAINTENANT)).toBe('il y a 2 ans')
  })

  it('rend « dans N … » pour une date future (création figée au passé)', () => {
    expect(dateRelativeFr(new Date(MAINTENANT.getTime() + 2 * JOUR), MAINTENANT)).toBe(
      'dans 2 jours',
    )
  })

  it('rend une chaîne vide sur date invalide au lieu de lever', () => {
    expect(dateRelativeFr(new Date('invalide'), MAINTENANT)).toBe('')
  })
})
