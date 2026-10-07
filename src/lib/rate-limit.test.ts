import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_WINDOW_MS,
  OFFRES_CREATION_MAX_PAR_COMPTE,
  OFFRES_CREATION_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from './rate-limit'

// ─── Politique de création d'offres (M6, D6) ─────────────────────────────────
// Verrouille le seau `offres:creation:*` : 10 créations/heure/compte, et
// surtout le piège de `recordAttempt` — son prune par DÉFAUT utilise la
// fenêtre de connexion (5 min) : tout appel d'une fenêtre PLUS LONGUE doit
// la passer, sinon l'historique (et donc le compte) est tronqué à 5 min.
// Store Map au niveau module : clés distinctes par scénario, timers
// factices restitués après chaque test.

afterEach(() => {
  vi.useRealTimers()
})

describe('constantes D6 (plafond de créations)', () => {
  it('expose le contrat validé : 10 créations par heure', () => {
    expect(OFFRES_CREATION_MAX_PAR_COMPTE).toBe(10)
    expect(OFFRES_CREATION_WINDOW_MS).toBe(60 * 60 * 1_000)
  })

  it("MAX_WINDOW_MS couvre la fenêtre D6 (invariant de purge de sweep())", () => {
    // sweep() ne supprime que les clés plus vieilles que MAX_WINDOW_MS :
    // si cette borne tombait SOUS OFFRES_CREATION_WINDOW_MS, un seau D6
    // encore actif serait purgé dès que la Map dépasse MAX_BUCKETS, et le
    // plafond 10/h deviendrait fail-open sans qu'aucun test ne grince.
    expect(MAX_WINDOW_MS).toBeGreaterThanOrEqual(OFFRES_CREATION_WINDOW_MS)
  })
})

describe('fenêtre explicite de recordAttempt (1 h > 5 min)', () => {
  it('conserve une tentative de 30 min quand la fenêtre 1 h est passée', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'))
    const cle = 'offres:creation:fenetre-explicite'

    recordAttempt(cle, OFFRES_CREATION_WINDOW_MS)
    vi.advanceTimersByTime(30 * 60 * 1_000)
    recordAttempt(cle, OFFRES_CREATION_WINDOW_MS)

    // Les DEUX tentatives sont encore dans la fenêtre d'une heure → à
    // max=2 le budget est épuisé. Sans le second argument, la première
    // aurait été purgée au bout de 5 min et la vérification passerait.
    const verif = checkRateLimit(cle, 2, OFFRES_CREATION_WINDOW_MS)
    expect(verif.allowed).toBe(false)
    expect(verif.retryAfterMs).toBeGreaterThan(0)
  })

  it('tronque à la fenêtre de connexion sans argument (le piège documenté)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T11:00:00.000Z'))
    const cle = 'offres:creation:fenetre-par-defaut'

    recordAttempt(cle)
    vi.advanceTimersByTime(6 * 60 * 1_000) // > LOGIN_WINDOW_MS (5 min)
    recordAttempt(cle)

    // La première tentative a été purgée : une seule reste comptée.
    const verif = checkRateLimit(cle, 2, OFFRES_CREATION_WINDOW_MS)
    expect(verif.allowed).toBe(true)
  })

  it('libère le budget quand toute la fenêtre d’une heure est dépassée', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    const cle = 'offres:creation:liberation'

    for (let i = 0; i < OFFRES_CREATION_MAX_PAR_COMPTE; i++) {
      recordAttempt(cle, OFFRES_CREATION_WINDOW_MS)
    }
    expect(
      checkRateLimit(cle, OFFRES_CREATION_MAX_PAR_COMPTE, OFFRES_CREATION_WINDOW_MS)
        .allowed,
    ).toBe(false)

    vi.advanceTimersByTime(OFFRES_CREATION_WINDOW_MS + 1_000)
    expect(
      checkRateLimit(cle, OFFRES_CREATION_MAX_PAR_COMPTE, OFFRES_CREATION_WINDOW_MS)
        .allowed,
    ).toBe(true)
  })
})
