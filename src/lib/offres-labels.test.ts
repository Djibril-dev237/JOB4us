import { StatutOffre } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  LIBELLES_STATUT,
  MESSAGES_ERREUR_TRANSITION,
  MESSAGES_MAJ,
  OFFRES_ACTIVES_MAX,
  OPTIONS_FILTRE_STATUT,
  VALEURS_FILTRE_STATUT,
  VARIANTE_STATUT,
  messageErreurTransition,
  messageMaj,
  statutAffiche,
  type StatutAffichable,
} from './offres-labels'

// ─── Contrats inter-vagues (P2 M6) ───────────────────────────────────────────
// Verrouillent les tables que les vagues 2 et 3 importent (actions, dashboard,
// formulaire, admin) : couverture exacte vs enum Prisma (anti-divergence,
// motif definitions.test.ts), variants de l'étape 3, frontière « expirée »,
// options de filtre et bandeaux `?maj=`.
// ---------------------------------------------------------------------------

const MAINTENANT = new Date('2026-10-07T10:00:00Z')

describe('LIBELLES_STATUT / VARIANTE_STATUT (couverture)', () => {
  it('couvre exactement les 4 statuts stockés + l’état dérivé', () => {
    const attendu = [...Object.values(StatutOffre), 'expiree'].sort()
    expect(Object.keys(LIBELLES_STATUT).sort()).toEqual(attendu)
    expect(Object.keys(VARIANTE_STATUT).sort()).toEqual(attendu)
  })

  it('reprend les libellés exacts (étape 2)', () => {
    expect(LIBELLES_STATUT).toEqual({
      brouillon: 'Brouillon',
      publiee: 'Publiée',
      cloturee: 'Clôturée',
      suspendue: 'Suspendue',
      expiree: 'Expirée',
    })
  })

  it('attribue les variants de l’étape 3', () => {
    expect(VARIANTE_STATUT).toEqual({
      brouillon: 'neutral',
      publiee: 'ok',
      cloturee: 'neutral',
      suspendue: 'danger',
      expiree: 'warn',
    })
  })
})

describe('statutAffiche (dérivation côté serveur)', () => {
  const JOUR = new Date('2026-10-07')

  it('ne dérive que les offres publiées : les autres passent telles quelles', () => {
    const datePassee = new Date('2026-01-01')
    expect(statutAffiche({ statut: 'brouillon', dateExpiration: datePassee }, MAINTENANT)).toBe(
      'brouillon',
    )
    expect(statutAffiche({ statut: 'cloturee', dateExpiration: JOUR }, MAINTENANT)).toBe(
      'cloturee',
    )
    expect(statutAffiche({ statut: 'suspendue', dateExpiration: JOUR }, MAINTENANT)).toBe(
      'suspendue',
    )
    // Clôturée avec une date ÉCHUE : reste « Clôturée », pas « Expirée ».
    expect(statutAffiche({ statut: 'cloturee', dateExpiration: datePassee }, MAINTENANT)).toBe(
      'cloturee',
    )
  })

  it('garde une publiée du jour entier, puis bascule en expirée au minuit suivant', () => {
    const publieeDuJour: StatutAffichable = {
      statut: 'publiee',
      dateExpiration: JOUR,
    }
    // 10:00Z = 11:00 à Douala : toujours le 7 → publiée.
    expect(statutAffiche(publieeDuJour, MAINTENANT)).toBe('publiee')
    // 22:59Z = 23:59 à Douala : toujours le jour inclus.
    expect(statutAffiche(publieeDuJour, new Date('2026-10-07T22:59:00Z'))).toBe('publiee')
    // 23:00Z = minuit du 8 à Douala : expirée.
    expect(statutAffiche(publieeDuJour, new Date('2026-10-07T23:00:00Z'))).toBe('expiree')
    // Offre à expiration future : publiée.
    expect(
      statutAffiche({ statut: 'publiee', dateExpiration: new Date('2026-11-02') }, MAINTENANT),
    ).toBe('publiee')
  })
})

describe('OPTIONS_FILTRE_STATUT (étape 3, ordre exact)', () => {
  it('propose « Toutes » puis les 5 états affichables', () => {
    expect(OPTIONS_FILTRE_STATUT.map((option) => option.libelle)).toEqual([
      'Toutes',
      'Brouillons',
      'Publiées',
      'Expirées',
      'Clôturées',
      'Suspendues',
    ])
    expect(OPTIONS_FILTRE_STATUT.map((option) => option.valeur)).toEqual([
      '',
      ...VALEURS_FILTRE_STATUT.slice(1),
    ])
  })

  it('aligne les valeurs sur les libellés de statut (valeur hors table = dérivée)', () => {
    expect([...VALEURS_FILTRE_STATUT].sort()).toEqual(
      [...Object.values(StatutOffre), '', 'expiree'].sort(),
    )
  })
})

describe('politique D4 et bandeaux ?maj=', () => {
  it('fixe le plafond de 20 offres publiées simultanées', () => {
    expect(OFFRES_ACTIVES_MAX).toBe(20)
  })

  it('expose les 9 clés de retour des actions, texte non vide', () => {
    expect(Object.keys(MESSAGES_MAJ).sort()).toEqual(
      [
        'brouillon',
        'cloturee',
        'dupliquee',
        'levee',
        'modifiee',
        'publiee',
        'rouverte',
        'suspendue',
        'supprimee',
      ].sort(),
    )
    for (const texte of Object.values(MESSAGES_MAJ)) {
      expect(texte.length).toBeGreaterThan(0)
      expect(texte).toMatch(/^[A-ZÀ-ÿ]/)
    }
  })

  it('refuse toute clé inconnue (jamais de texte depuis l’URL)', () => {
    expect(messageMaj('publiee')).toBe('Offre publiée.')
    expect(messageMaj('inconnue')).toBeNull()
    expect(messageMaj('<script>')).toBeNull()
    expect(messageMaj(null)).toBeNull()
    expect(messageMaj(undefined)).toBeNull()
  })
})

describe('MESSAGES_ERREUR_TRANSITION (bandeaux ?erreur=)', () => {
  it('expose exactement les 6 clés de refus, texte non vide', () => {
    expect(Object.keys(MESSAGES_ERREUR_TRANSITION).sort()).toEqual(
      ['date', 'forme', 'inconnue', 'limite', 'quota', 'statut'].sort(),
    )
    for (const texte of Object.values(MESSAGES_ERREUR_TRANSITION)) {
      expect(texte.length).toBeGreaterThan(0)
      expect(texte).toMatch(/^[A-ZÀ-ÿ]/)
    }
  })

  it('cite le plafond D4 depuis la constante (jamais un 20 en dur)', () => {
    expect(MESSAGES_ERREUR_TRANSITION.quota).toContain(String(OFFRES_ACTIVES_MAX))
  })

  it('refuse toute clé inconnue (fail-closed comme messageMaj)', () => {
    expect(messageErreurTransition('statut')).toBe(
      'Cette action n’est plus disponible pour cette offre.',
    )
    expect(messageErreurTransition('inconnue')).toBe(
      'La mise à jour de l’offre a échoué.',
    )
    expect(messageErreurTransition('<script>')).toBeNull()
    expect(messageErreurTransition(null)).toBeNull()
    expect(messageErreurTransition(undefined)).toBeNull()
  })

  it('ne croise jamais les deux tables (?maj= vs ?erreur=)', () => {
    const clesMaj = Object.keys(MESSAGES_MAJ)
    for (const cle of Object.keys(MESSAGES_ERREUR_TRANSITION)) {
      expect(clesMaj).not.toContain(cle)
    }
    // Un aiguillage qui basculerait sur messageErreurTransition avec une
    // clé de succès n'afficherait rien plutôt qu'un mauvais texte.
    expect(messageErreurTransition('publiee')).toBeNull()
  })
})
