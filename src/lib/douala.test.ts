import { describe, expect, it } from 'vitest'

import { dateCouranteDouala, estExpiree, minuitDouala } from './douala'

// ─── Frontière Douala du cycle de vie M6 ─────────────────────────────────────
// Le test de `dateCouranteDouala` a été DÉPLACÉ ici (P2) en même temps que
// le helper extrait de offres-public.ts : la règle appartient désormais à
// douala.ts et reste verrouillée à l'identique. `estExpiree` (nouveau, M6)
// prouve qu'il implémente EXACTEMENT la frontière inclusive du prédicat
// public : jour d'expiration entier à Douala, expiration au 23:00Z suivant.
// ---------------------------------------------------------------------------

describe('dateCouranteDouala', () => {
  it('borne les dates sur le fuseau du pays et pas sur celui du serveur', () => {
    // 22:30Z = 23:30 à Douala : toujours le 2 octobre.
    expect(dateCouranteDouala(new Date('2026-10-02T22:30:00Z'))).toBe(
      '2026-10-02',
    )
    // 23:30Z = 00:30 à Douala : déjà le 3 octobre.
    expect(dateCouranteDouala(new Date('2026-10-02T23:30:00Z'))).toBe(
      '2026-10-03',
    )
    // Fin de journée locale : 22:59Z = 23:59 à Douala (toujours le 7) ;
    // 23:00Z = minuit à Douala → déjà le 8. La bascule est exactement
    // sur le minuit local, pas sur minuit UTC.
    expect(dateCouranteDouala(new Date('2026-10-07T22:59:00Z'))).toBe(
      '2026-10-07',
    )
    expect(dateCouranteDouala(new Date('2026-10-07T23:00:00Z'))).toBe(
      '2026-10-08',
    )
  })
})

describe('minuitDouala', () => {
  it('donne 23:00Z la veille (UTC+1 sans DST)', () => {
    expect(minuitDouala('2026-10-07').toISOString()).toBe(
      '2026-10-06T23:00:00.000Z',
    )
    expect(minuitDouala('2026-01-01').toISOString()).toBe(
      '2025-12-31T23:00:00.000Z',
    )
  })
})

describe('estExpiree', () => {
  const EXPIRATION = new Date('2026-10-07')

  it('inclut tout le jour d’expiration à Douala (frontière inclusive)', () => {
    // Jour même, en milieu de journée locale (10:00Z = 11:00 Douala).
    expect(estExpiree(EXPIRATION, new Date('2026-10-07T10:00:00Z'))).toBe(false)
    // Dernière minute locale : 22:59Z = 23:59 du 7 à Douala.
    expect(estExpiree(EXPIRATION, new Date('2026-10-07T22:59:00Z'))).toBe(false)
    // 23:00Z = minuit du 8 à Douala : l'expiration commence.
    expect(estExpiree(EXPIRATION, new Date('2026-10-07T23:00:00Z'))).toBe(true)
    // Jours suivants : toujours expirée.
    expect(estExpiree(EXPIRATION, new Date('2026-10-20T12:00:00Z'))).toBe(true)
  })

  it('laisse passer une date d’expiration future', () => {
    expect(estExpiree(new Date('2026-11-02'), new Date('2026-10-07T12:00:00Z'))).toBe(
      false,
    )
  })
})
