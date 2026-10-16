import { describe, expect, it } from 'vitest'

import {
  METADONNEES,
  TEXTES,
  TYPE_NOTIFICATIONS,
  TYPES_NON_DESACTIVABLES,
  preferencesParDefaut,
  texteGroupeMessages,
  texteNotification,
  type TypeNotification,
} from './notifications-labels'

// ─── Contrats inter-SA (M9, pré-vague) ───────────────────────────────────────
// Verrouillent ce que les vagues suivantes importent : catalogue FERMÉ de 8
// types (l'enum Prisma de la Vague 1 en reprendra les valeurs), métadonnées
// complètes pour chaque type, défauts dérivés (jamais de seed), fabrique de
// texte à variables FERMÉE (règle de confidentialité structurelle), table
// TEXTES verrouillée mot pour mot (règle anti-vibecoding).
// ---------------------------------------------------------------------------

describe('TYPE_NOTIFICATIONS (catalogue fermé)', () => {
  it('expose exactement les 8 types du catalogue validé', () => {
    expect([...TYPE_NOTIFICATIONS].sort()).toEqual(
      [
        'candidatureRecue',
        'candidatureRetiree',
        'entrepriseCertifiee',
        'nouveauMessage',
        'offreIndisponible',
        'offrePubliee',
        'signalementRecu',
        'statutCandidature',
      ].sort(),
    )
  })

  it('chaque type a ses métadonnées complètes (anti-divergence)', () => {
    for (const type of TYPE_NOTIFICATIONS) {
      const meta = METADONNEES[type]
      expect(meta.libelle.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
      expect(typeof meta.emailParDefaut).toBe('boolean')
      expect(typeof meta.desactivable).toBe('boolean')
    }
  })

  it('les 6 types de base partent par email par défaut ; les 2 secondaires non', () => {
    expect(METADONNEES.candidatureRecue.emailParDefaut).toBe(true)
    expect(METADONNEES.statutCandidature.emailParDefaut).toBe(true)
    expect(METADONNEES.candidatureRetiree.emailParDefaut).toBe(true)
    expect(METADONNEES.nouveauMessage.emailParDefaut).toBe(true)
    expect(METADONNEES.offreIndisponible.emailParDefaut).toBe(true)
    expect(METADONNEES.signalementRecu.emailParDefaut).toBe(true)
    // Secondaires repris du legacy : in-app seulement (Étape 3 validée).
    expect(METADONNEES.offrePubliee.emailParDefaut).toBe(false)
    expect(METADONNEES.entrepriseCertifiee.emailParDefaut).toBe(false)
  })

  it('seul signalementRecu est non désactivable (devoir de modération)', () => {
    expect(TYPES_NON_DESACTIVABLES).toEqual(['signalementRecu'])
  })
})

describe('preferencesParDefaut (défauts dérivés du catalogue)', () => {
  it('couvre les 8 types et reflète emailParDefaut', () => {
    const defauts = preferencesParDefaut()
    expect(Object.keys(defauts).sort()).toEqual([...TYPE_NOTIFICATIONS].sort())
    for (const type of TYPE_NOTIFICATIONS) {
      expect(defauts[type]).toBe(METADONNEES[type].emailParDefaut)
    }
  })
})

describe('texteNotification (fabrique à variables fermées)', () => {
  it('chaque type du catalogue produit titre et contenu non vides', () => {
    // Une entrée par type, avec SES seules variables (union discriminée).
    const productions = [
      texteNotification({ type: 'candidatureRecue', titreOffre: 'Développeur' }),
      texteNotification({
        type: 'statutCandidature',
        titreOffre: 'Développeur',
        libelleStatut: 'Acceptée',
      }),
      texteNotification({ type: 'candidatureRetiree', titreOffre: 'Développeur' }),
      texteNotification({ type: 'nouveauMessage', acteur: 'Marie Dupont', compteur: 3 }),
      texteNotification({ type: 'offreIndisponible', titreOffre: 'Développeur' }),
      texteNotification({ type: 'signalementRecu' }),
      texteNotification({ type: 'offrePubliee', titreOffre: 'Développeur' }),
      texteNotification({ type: 'entrepriseCertifiee', nomEntreprise: 'ACME' }),
    ]
    for (const { titre, contenu } of productions) {
      expect(titre.length).toBeGreaterThan(0)
      expect(contenu.length).toBeGreaterThan(0)
    }
  })

  it('signalementRecu ne divulgue AUCUN détail (titre + phrase fixe)', () => {
    expect(texteNotification({ type: 'signalementRecu' })).toEqual({
      titre: 'Signalement reçu',
      contenu: 'Un nouveau signalement attend d’être examiné.',
    })
  })

  it('recopie les variables telles quelles (le titre d’offre arrive intact)', () => {
    const { contenu } = texteNotification({
      type: 'candidatureRecue',
      titreOffre: 'Ingénieur <script>(x)</script>',
    })
    // Ce module n'ESCAPPE PAS (le rendu le fait) : il recopie. Le test
    // verrouille que rien n'est tronqué ni réécrit en route.
    expect(contenu).toContain('Ingénieur <script>(x)</script>')
  })
})

describe('texteGroupeMessages (regroupement)', () => {
  it('singulier pour 1, pluriel au-delà', () => {
    expect(texteGroupeMessages(1)).toBe('Nouveau message')
    expect(texteGroupeMessages(2)).toBe('2 nouveaux messages')
    expect(texteGroupeMessages(12)).toBe('12 nouveaux messages')
  })
})

describe('TEXTES (table verrouillée, anti-vibecoding)', () => {
  it('aucune valeur vide, aucun tiret cadratin (règle design)', () => {
    for (const [cle, valeur] of Object.entries(TEXTES)) {
      expect(valeur.length, cle).toBeGreaterThan(0)
      expect(valeur, cle).not.toContain('—')
      expect(valeur, cle).not.toContain('–')
    }
  })

  it('aucune mention d’outil ni de fabrication (règle design)', () => {
    const interdits = ['AI', 'made with', 'Generated', 'GPT']
    for (const [cle, valeur] of Object.entries(TEXTES)) {
      for (const interdit of interdits) {
        expect(valeur, `${cle} / ${interdit}`).not.toContain(interdit)
      }
    }
  })
})

describe('types exports (contrat TypeScript)', () => {
  it('TypeNotification accepte chaque membre du catalogue', () => {
    const tous: TypeNotification[] = [...TYPE_NOTIFICATIONS]
    expect(tous).toHaveLength(8)
  })
})
