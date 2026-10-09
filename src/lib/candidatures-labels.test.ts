import { StatutCandidature } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import type { BadgeVariant } from '@/components/ui/badge'

import {
  LIBELLES_STATUT,
  MESSAGES_ERREUR_CANDIDATURE,
  MESSAGES_MAJ_CANDIDATURE,
  OPTIONS_FILTRE_CANDIDATURE,
  STATUTS,
  STATUTS_TERMINAUX,
  VALEURS_FILTRE_CANDIDATURE,
  VARIANTE_STATUT,
  messageErreurCandidature,
  messageMajCandidature,
  peutTransiter,
  transitionsAutorisees,
  type ActeurCandidature,
} from './candidatures-labels'

// ─── Contrats inter-vagues (M7) ──────────────────────────────────────────────
// Verrouillent ce que les vagues suivantes importent (actions, listes
// candidat/recruteur, badges, bandeaux) : couverture exacte vs enum Prisma
// (anti-divergence, motif definitions.test.ts), libellés singuliers et
// pluriels de l'étape 2, matrice de transitions ÉPUISÉE en 7 × 3 × 7, et
// bandeaux fail-closed (clé inconnue → null).
// ---------------------------------------------------------------------------

const ACTEURS: readonly ActeurCandidature[] = ['candidat', 'recruteur', 'admin']

/** Les 5 cibles que le candidat ne doit JAMAIS atteindre (droits réservés). */
const CIBLES_CANDIDAT_INTERDITES: readonly StatutCandidature[] = [
  'consultee',
  'preselectionnee',
  'entretien',
  'acceptee',
  'refusee',
]

/** Variants autorisés par ui/badge (BadgeVariant). */
const VARIANTS_VALIDES: readonly BadgeVariant[] = [
  'neutral',
  'brand',
  'ok',
  'warn',
  'danger',
  'accent',
]

/**
 * Matrice de référence Étape 2, recopiée ICI (et non importée) : le test
 * devient la spécification exécutable de TRANSITIONS — si le module dérive,
 * l'épuisement 7 × 3 × 7 diverge.
 */
const MATRICE: Record<
  StatutCandidature,
  Record<ActeurCandidature, readonly StatutCandidature[]>
> = {
  envoyee: {
    candidat: ['retiree'],
    recruteur: ['consultee', 'preselectionnee', 'entretien'],
    admin: ['consultee', 'preselectionnee', 'entretien'],
  },
  consultee: {
    candidat: ['retiree'],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee'],
  },
  preselectionnee: {
    candidat: ['retiree'],
    recruteur: ['entretien', 'acceptee', 'refusee'],
    admin: ['entretien', 'acceptee', 'refusee'],
  },
  entretien: {
    candidat: ['retiree'],
    recruteur: ['preselectionnee', 'acceptee', 'refusee'],
    admin: ['preselectionnee', 'acceptee', 'refusee'],
  },
  acceptee: {
    candidat: [],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee', 'retiree'],
  },
  refusee: {
    candidat: [],
    recruteur: ['preselectionnee'],
    admin: ['preselectionnee', 'retiree'],
  },
  retiree: {
    candidat: [],
    recruteur: [],
    admin: [],
  },
}

describe('STATUTS / LIBELLES_STATUT / VARIANTE_STATUT (couverture)', () => {
  it('STATUTS reprend les 7 valeurs de l’enum Prisma, dans l’ordre', () => {
    expect([...STATUTS]).toEqual([
      'envoyee',
      'consultee',
      'preselectionnee',
      'entretien',
      'acceptee',
      'refusee',
      'retiree',
    ])
    expect([...STATUTS].sort()).toEqual([...Object.values(StatutCandidature)].sort())
    expect(STATUTS).toHaveLength(7)
  })

  it('couvre exactement les 7 statuts stockés (libellés ET variants)', () => {
    const attendu = [...Object.values(StatutCandidature)].sort()
    expect(Object.keys(LIBELLES_STATUT).sort()).toEqual(attendu)
    expect(Object.keys(VARIANTE_STATUT).sort()).toEqual(attendu)
  })

  it('reprend les libellés singuliers exacts (identiques candidat/recruteur)', () => {
    expect(LIBELLES_STATUT).toEqual({
      envoyee: 'Envoyée',
      consultee: 'Consultée',
      preselectionnee: 'Présélectionnée',
      entretien: 'Entretien',
      acceptee: 'Acceptée',
      refusee: 'Refusée',
      retiree: 'Retirée',
    })
  })

  it('attribue les variants de l’intégration', () => {
    expect(VARIANTE_STATUT).toEqual({
      envoyee: 'brand',
      consultee: 'neutral',
      preselectionnee: 'accent',
      entretien: 'warn',
      acceptee: 'ok',
      refusee: 'danger',
      retiree: 'neutral',
    })
  })

  it('ne sort jamais de la gamme de variants de ui/badge', () => {
    for (const variante of Object.values(VARIANTE_STATUT)) {
      expect(VARIANTS_VALIDES).toContain(variante)
    }
  })

  it('réserve `accent` à la progression et `ok` au résultat final', () => {
    expect(VARIANTE_STATUT.preselectionnee).toBe('accent')
    expect(VARIANTE_STATUT.acceptee).toBe('ok')
    expect(VARIANTE_STATUT.refusee).toBe('danger')
    expect(VARIANTE_STATUT.retiree).toBe('neutral')
  })
})

describe('chips de filtre (candidat | recruteur)', () => {
  it('propose « Toutes » + les 7 statuts dans l’ordre STATUTS, des deux côtés', () => {
    const valeursAttendues = ['toutes', ...STATUTS]
    expect([...VALEURS_FILTRE_CANDIDATURE.candidat]).toEqual(valeursAttendues)
    expect([...VALEURS_FILTRE_CANDIDATURE.recruteur]).toEqual(valeursAttendues)
    expect(OPTIONS_FILTRE_CANDIDATURE.candidat.map((option) => option.valeur)).toEqual(
      valeursAttendues,
    )
    expect(OPTIONS_FILTRE_CANDIDATURE.recruteur.map((option) => option.valeur)).toEqual(
      valeursAttendues,
    )
  })

  it('verrouille les libellés pluriels côté candidat (terminologie étape 2)', () => {
    expect(OPTIONS_FILTRE_CANDIDATURE.candidat.map((option) => option.libelle)).toEqual([
      'Toutes',
      'Envoyées',
      'Consultées',
      'Présélectionnées',
      'Entretien',
      'Acceptées',
      'Refusées',
      'Retirées',
    ])
  })

  it('verrouille les libellés singuliers côté recruteur (terminologie étape 2)', () => {
    expect(OPTIONS_FILTRE_CANDIDATURE.recruteur.map((option) => option.libelle)).toEqual([
      'Toutes',
      'Nouvelle',
      'Consultée',
      'Présélectionnée',
      'Entretien',
      'Acceptée',
      'Refusée',
      'Retirée',
    ])
  })

  it('ne diffère que par les libellés (mêmes valeurs des deux côtés)', () => {
    expect([...VALEURS_FILTRE_CANDIDATURE.candidat]).toEqual([
      ...VALEURS_FILTRE_CANDIDATURE.recruteur,
    ])
    for (const cote of ['candidat', 'recruteur'] as const) {
      expect(OPTIONS_FILTRE_CANDIDATURE[cote]).toHaveLength(8)
    }
  })

  it('garde « toutes » en tête = aucun filtre (aucune valeur fantôme)', () => {
    expect(VALEURS_FILTRE_CANDIDATURE.candidat[0]).toBe('toutes')
    expect(VALEURS_FILTRE_CANDIDATURE.recruteur[0]).toBe('toutes')
    expect(OPTIONS_FILTRE_CANDIDATURE.candidat[0].valeur).toBe('toutes')
    expect(OPTIONS_FILTRE_CANDIDATURE.recruteur[0].valeur).toBe('toutes')
    const valeursUniques = new Set(VALEURS_FILTRE_CANDIDATURE.candidat)
    expect(valeursUniques.size).toBe(8)
  })
})

describe('machine à états (matrice Étape 2, épuisement 7 × 3 × 7)', () => {
  it('épuise les 147 triplets : peutTransiter = présence dans la matrice', () => {
    const ecarts: string[] = []
    let verifications = 0
    for (const statut of STATUTS) {
      for (const acteur of ACTEURS) {
        for (const cible of STATUTS) {
          const attendu = MATRICE[statut][acteur].includes(cible)
          verifications += 1
          if (peutTransiter(statut, cible, acteur) !== attendu) {
            ecarts.push(`${statut} --${acteur}--> ${cible} (attendu : ${String(attendu)})`)
          }
        }
      }
    }
    expect(verifications).toBe(147)
    expect(ecarts).toEqual([])
  })

  it('expose exactement les cibles de la matrice (7 statuts × 3 acteurs)', () => {
    for (const statut of STATUTS) {
      for (const acteur of ACTEURS) {
        expect([...transitionsAutorisees(statut, acteur)]).toEqual([...MATRICE[statut][acteur]])
      }
    }
  })

  it('n’autorise JAMAIS une cible « envoyee » (seul le CREATE écrit ce statut)', () => {
    for (const statut of STATUTS) {
      for (const acteur of ACTEURS) {
        expect(peutTransiter(statut, 'envoyee', acteur)).toBe(false)
      }
    }
  })

  it('n’autorise AUCUNE transition depuis « retiree » (fige la ligne)', () => {
    for (const cible of STATUTS) {
      for (const acteur of ACTEURS) {
        expect(peutTransiter('retiree', cible, acteur)).toBe(false)
      }
    }
    expect(transitionsAutorisees('retiree', 'admin')).toEqual([])
  })

  it('interdit au candidat toute cible autre que « retiree »', () => {
    for (const statut of STATUTS) {
      for (const cible of CIBLES_CANDIDAT_INTERDITES) {
        expect(peutTransiter(statut, cible, 'candidat')).toBe(false)
      }
      expect(peutTransiter(statut, 'retiree', 'candidat')).toBe(
        statut !== 'acceptee' && statut !== 'refusee' && statut !== 'retiree',
      )
    }
  })

  it('refuse explicitement les combinaisons notées interdites à l’étape 2', () => {
    expect(peutTransiter('consultee', 'entretien', 'recruteur')).toBe(false)
    expect(peutTransiter('consultee', 'refusee', 'recruteur')).toBe(false)
    expect(peutTransiter('consultee', 'acceptee', 'admin')).toBe(false)
    expect(peutTransiter('envoyee', 'refusee', 'recruteur')).toBe(false)
    expect(peutTransiter('envoyee', 'acceptee', 'admin')).toBe(false)
    expect(peutTransiter('consultee', 'consultee', 'recruteur')).toBe(false)
  })

  it('conserve la réouverture (→ preselectionnee) et le retrait admin', () => {
    expect(peutTransiter('acceptee', 'preselectionnee', 'recruteur')).toBe(true)
    expect(peutTransiter('refusee', 'preselectionnee', 'admin')).toBe(true)
    expect(peutTransiter('acceptee', 'retiree', 'admin')).toBe(true)
    expect(peutTransiter('acceptee', 'retiree', 'recruteur')).toBe(false)
    expect(peutTransiter('refusee', 'retiree', 'candidat')).toBe(false)
  })

  it('délimite les statuts terminaux (acceptee, refusee, retiree)', () => {
    expect([...STATUTS_TERMINAUX]).toEqual(['acceptee', 'refusee', 'retiree'])
    for (const statut of STATUTS) {
      const terminal = STATUTS_TERMINAUX.includes(statut)
      expect(terminal).toBe(
        statut === 'acceptee' || statut === 'refusee' || statut === 'retiree',
      )
    }
    // Terminal ≠ inaccessible : un admin y passe encore (réouverture/retrait).
    expect(peutTransiter('acceptee', 'preselectionnee', 'admin')).toBe(true)
  })

  it('refuse (sans crash) une entrée hors enum — fail-closed réel (revue Vague 1, C3)', () => {
    // Un statut legacy ('vue', 'retenue') ou un acteur inconnu doit valoir
    // REFUS, jamais un TypeError qui transformerait un refus en 500.
    for (const horsEnum of ['vue', 'retenue', 'inconnu', '', '__proto__']) {
      const depuis = horsEnum as StatutCandidature
      expect(peutTransiter(depuis, 'retiree', 'candidat')).toBe(false)
      expect(peutTransiter('envoyee', depuis, 'recruteur')).toBe(false)
      expect(transitionsAutorisees(depuis, 'admin')).toEqual([])
    }
    for (const acteurInconnu of ['superadmin', 'systeme', '']) {
      expect(peutTransiter('envoyee', 'consultee', acteurInconnu as ActeurCandidature)).toBe(false)
      expect(transitionsAutorisees('envoyee', acteurInconnu as ActeurCandidature)).toEqual([])
    }
  })

  it('ne expose jamais la table vivante (copie immuable — revue Vague 1, O1)', () => {
    const cibles = transitionsAutorisees('envoyee', 'candidat') as StatutCandidature[]
    cibles.push('acceptee')
    // La tentative de mutation ne doit pas atteindre la matrice partagée…
    expect(peutTransiter('envoyee', 'acceptee', 'candidat')).toBe(false)
    expect([...transitionsAutorisees('envoyee', 'candidat')]).toEqual(['retiree'])
    // …ni la copie suivante.
    expect([...transitionsAutorisees('envoyee', 'candidat')]).not.toContain('acceptee')
  })
})

describe('MESSAGES_MAJ_CANDIDATURE (bandeaux ?maj=)', () => {
  it('expose exactement les 2 clés de succès, texte non vide', () => {
    expect(Object.keys(MESSAGES_MAJ_CANDIDATURE).sort()).toEqual(['envoyee', 'retiree'])
    for (const texte of Object.values(MESSAGES_MAJ_CANDIDATURE)) {
      expect(texte.length).toBeGreaterThan(0)
      expect(texte).toMatch(/^[A-ZÀ-ÿ]/)
    }
  })

  it('verrouille les textes exacts', () => {
    expect(MESSAGES_MAJ_CANDIDATURE).toEqual({
      envoyee: 'Candidature envoyée.',
      retiree: 'Candidature retirée.',
    })
  })

  it('refuse toute clé inconnue (jamais de texte depuis l’URL)', () => {
    expect(messageMajCandidature('envoyee')).toBe('Candidature envoyée.')
    expect(messageMajCandidature('retiree')).toBe('Candidature retirée.')
    expect(messageMajCandidature('inconnue')).toBeNull()
    expect(messageMajCandidature('<script>')).toBeNull()
    expect(messageMajCandidature(null)).toBeNull()
    expect(messageMajCandidature(undefined)).toBeNull()
  })
})

describe('MESSAGES_ERREUR_CANDIDATURE (bandeaux ?erreur=)', () => {
  it('expose exactement les 8 clés de refus, texte non vide', () => {
    expect(Object.keys(MESSAGES_ERREUR_CANDIDATURE).sort()).toEqual(
      [
        'doublon',
        'echec-stockage',
        'fichier-invalide',
        'offre-indisponible',
        'profil-incomplet',
        'retrait',
        'transition',
        'trop-de-demandes',
      ].sort(),
    )
    for (const texte of Object.values(MESSAGES_ERREUR_CANDIDATURE)) {
      expect(texte.length).toBeGreaterThan(0)
      expect(texte).toMatch(/^[A-ZÀ-ÿ]/)
    }
  })

  it('verrouille les textes exacts (dont les LEGACY du contrôleur PHP)', () => {
    expect(MESSAGES_ERREUR_CANDIDATURE).toEqual({
      doublon: 'Vous avez déjà postulé à cette offre.',
      'offre-indisponible': "Cette offre n'est plus disponible.",
      'profil-incomplet': 'Ajoutez un CV à votre profil avant de postuler.',
      'fichier-invalide': 'Le fichier sélectionné n’est pas un CV valide (format ou taille).',
      'echec-stockage': 'L’envoi du CV a échoué. Réessayez plus tard.',
      'trop-de-demandes': 'Trop de tentatives. Réessayez plus tard.',
      transition: "Ce changement de statut n'est pas autorisé.",
      retrait: 'Impossible de retirer cette candidature.',
    })
  })

  it('couvre chaque code de refus du snapshot CV (revue Vague 1, C1)', () => {
    // ResultatSnapshotCv produit ces 3 codes — chacun doit pouvoir s'afficher.
    expect(messageErreurCandidature('profil-incomplet')).not.toBeNull()
    expect(messageErreurCandidature('fichier-invalide')).not.toBeNull()
    expect(messageErreurCandidature('echec-stockage')).not.toBeNull()
  })

  it('refuse toute clé inconnue (fail-closed comme messageMajCandidature)', () => {
    expect(messageErreurCandidature('doublon')).toBe(
      'Vous avez déjà postulé à cette offre.',
    )
    expect(messageErreurCandidature('retrait')).toBe(
      'Impossible de retirer cette candidature.',
    )
    expect(messageErreurCandidature('inconnue')).toBeNull()
    expect(messageErreurCandidature('<script>')).toBeNull()
    expect(messageErreurCandidature(null)).toBeNull()
    expect(messageErreurCandidature(undefined)).toBeNull()
  })

  it('ne croise jamais les deux tables (?maj= vs ?erreur=)', () => {
    const clesMaj = Object.keys(MESSAGES_MAJ_CANDIDATURE)
    for (const cle of Object.keys(MESSAGES_ERREUR_CANDIDATURE)) {
      expect(clesMaj).not.toContain(cle)
    }
    // Un aiguillage qui basculerait sur messageErreurCandidature avec une clé
    // de succès n'afficherait rien plutôt qu'un mauvais texte.
    expect(messageErreurCandidature('envoyee')).toBeNull()
    expect(messageMajCandidature('doublon')).toBeNull()
  })
})
