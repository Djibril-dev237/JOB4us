import { StatutCandidature } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  STATUTS_TERMINAIRES,
  TEXTES,
  estLectureSeule,
  libelleStatutSignalement,
  motifLectureSeule,
  texteMotifLectureSeule,
  varianteStatutConversation,
} from './messagerie-labels'

// ─── Contrats inter-SA (M8, Vague 1) ─────────────────────────────────────────
// Verrouillent ce que les SA suivantes importent (liste de conversations,
// fil non lues, fil de messages, actions serveur) : lecture seule dérivée
// des 7 statuts de l'enum Prisma (anti-divergence, motif
// definitions.test.ts), table TEXTES verrouillée mot pour mot (règle
// anti-vibecoding : AUCUN texte inventé ni reformulé), badge de fin de
// conversation et bandeaux des 4 motifs de fermeture d'écriture.
// ---------------------------------------------------------------------------

/** Table de référence ÉPUISÉE sur les 7 statuts, recopiée ICI : si `motifLectureSeule` dérive, l'exhaustivité casse. */
const ATTENDU: Record<
  StatutCandidature,
  { lectureSeule: boolean; motif: 'acceptee' | 'refusee' | 'retiree' | null }
> = {
  envoyee: { lectureSeule: false, motif: null },
  consultee: { lectureSeule: false, motif: null },
  preselectionnee: { lectureSeule: false, motif: null },
  entretien: { lectureSeule: false, motif: null },
  acceptee: { lectureSeule: true, motif: 'acceptee' },
  refusee: { lectureSeule: true, motif: 'refusee' },
  retiree: { lectureSeule: true, motif: 'retiree' },
}

describe('STATUTS_TERMINAIRES (couverture vs enum Prisma)', () => {
  it('expose exactement les 3 statuts figés, tous présents dans l’enum', () => {
    expect([...STATUTS_TERMINAIRES].sort()).toEqual(['acceptee', 'refusee', 'retiree'])
    for (const terminal of STATUTS_TERMINAIRES) {
      expect(Object.values(StatutCandidature)).toContain(terminal)
    }
  })
})

describe('estLectureSeule / motifLectureSeule (exhaustif sur les 7 statuts)', () => {
  it('couvre exactement les 7 valeurs de l’enum (anti-divergence)', () => {
    expect(Object.keys(ATTENDU).sort()).toEqual([...Object.values(StatutCandidature)].sort())
  })

  it('dérive les deux fonctions de la même table, statut par statut', () => {
    for (const statut of Object.values(StatutCandidature)) {
      const attendu = ATTENDU[statut]
      expect(estLectureSeule(statut), `estLectureSeule(${statut})`).toBe(attendu.lectureSeule)
      expect(motifLectureSeule(statut), `motifLectureSeule(${statut})`).toBe(attendu.motif)
    }
  })

  it('ne fige que les 3 terminaux : les 4 états actifs restent ouverts', () => {
    // envoyee / consultee / preselectionnee / entretien : l'échange reste
    // possible (le recruteur fait avancer la candidature, le candidat peut
    // retirer) → jamais lecture seule, jamais de motif.
    for (const actif of ['envoyee', 'consultee', 'preselectionnee', 'entretien'] as const) {
      expect(estLectureSeule(actif)).toBe(false)
      expect(motifLectureSeule(actif)).toBeNull()
    }
    for (const terminal of STATUTS_TERMINAIRES) {
      expect(estLectureSeule(terminal)).toBe(true)
      expect(motifLectureSeule(terminal)).toBe(terminal)
    }
  })
})

describe('TEXTES (source unique, aucun texte inventé)', () => {
  it('expose exactement les 49 clés du cahier des charges', () => {
    // 19 clés Vague 1 + 13 clés d'écran Vague 2 + 17 clés de modération
    // Vague 3 (confirmations de blocage, écran admin /admin/signalements —
    // textes : vues legacy pour le côté candidat/recruteur, vocabulaire du
    // schema pour le côté admin qui n'a pas d'ancêtre legacy).
    expect(Object.keys(TEXTES).sort()).toEqual(
      [
        'actualisationEchouee',
        'actionEchouee',
        'bloquer',
        'chargement',
        'chargerPlus',
        'cloturer',
        'compteurConversations',
        'confirmationBlocage',
        'confirmationDeblocage',
        'confirmationMasquage',
        'conversationVide',
        'debloquer',
        'ecritureBloquee',
        'envoiEchoue',
        'envoiRefuse',
        'envoyer',
        'fermer',
        'filtreNonLues',
        'filtreOuverts',
        'filtreToutes',
        'filtreTraites',
        'interlocuteurBloque',
        'interlocuteurDebloque',
        'lectureSeuleAcceptee',
        'lectureSeuleRefusee',
        'lectureSeuleRetiree',
        'lienCandidature',
        'lienOffre',
        'listeSignalementsVide',
        'listeVide',
        'listeVideNonLues',
        'masquer',
        'moderationLue',
        'motifSignalement',
        'noteInterne',
        'nouveauxMessages',
        'pagination',
        'placeholderMessage',
        'signalementCloture',
        'signalementDejaCloture',
        'signalementDejaFait',
        'signalementEchoue',
        'signalementEnvoye',
        'signaler',
        'statutOuvert',
        'statutTraite',
        'titreMessages',
        'titreSignalements',
        'tropDeMessages',
      ].sort(),
    )
  })

  it('reprend les libellés exacts, mot pour mot (apostrophes comprises)', () => {
    expect(TEXTES).toEqual({
      lectureSeuleAcceptee: 'Cette conversation est en lecture seule : la candidature est acceptée.',
      lectureSeuleRefusee: 'Cette conversation est en lecture seule : la candidature est refusée.',
      lectureSeuleRetiree: 'Cette conversation est en lecture seule : la candidature a été retirée.',
      ecritureBloquee: 'Vous ne pouvez plus écrire dans cette conversation.',
      listeVide: 'Vos échanges apparaîtront ici après une candidature.',
      listeVideNonLues: 'Aucune conversation non lue.',
      conversationVide: 'Aucun message pour l’instant.',
      debloquer: 'Débloquer',
      envoiEchoue: 'Message non envoyé. Réessayez.',
      envoiRefuse: 'Envoi refusé.',
      actualisationEchouee: 'Actualisation impossible.',
      signalementEnvoye: 'Signalement transmis.',
      signalementDejaFait: 'Vous avez déjà signalé ce message.',
      interlocuteurBloque: 'Interlocuteur bloqué.',
      interlocuteurDebloque: 'Interlocuteur débloqué.',
      moderationLue: 'Consultation de modération : cette lecture est journalisée.',
      lienOffre: 'Voir l’offre',
      lienCandidature: 'Voir la candidature',
      chargement: 'Chargement…',
      nouveauxMessages: 'Nouveaux messages',
      pagination: 'Pagination',
      titreMessages: 'Messages',
      filtreToutes: 'Toutes',
      filtreNonLues: 'Non lues',
      compteurConversations: 'conversation(s)',
      chargerPlus: 'Charger les messages plus anciens',
      envoyer: 'Envoyer',
      placeholderMessage: 'Écrivez votre message...',
      masquer: 'Masquer',
      bloquer: 'Bloquer',
      signaler: 'Signaler',
      fermer: 'Fermer',
      confirmationMasquage: 'Masquer cette conversation ? Elle disparaîtra de votre liste.',
      tropDeMessages: 'Trop de messages envoyés. Patientez une minute.',
      confirmationBlocage: 'Bloquer cet interlocuteur ? Il ne pourra plus vous écrire, dans aucune conversation.',
      confirmationDeblocage: 'Débloquer cet interlocuteur ? Il pourra de nouveau vous écrire.',
      signalementEchoue: 'Signalement non transmis. Réessayez.',
      actionEchouee: 'Action impossible. Réessayez.',
      titreSignalements: 'Signalements',
      filtreOuverts: 'Ouverts',
      filtreTraites: 'Traités',
      listeSignalementsVide: 'Aucun signalement.',
      cloturer: 'Clôturer',
      signalementCloture: 'Signalement clôturé.',
      signalementDejaCloture: 'Ce signalement est déjà clôturé.',
      noteInterne: 'Note interne',
      motifSignalement: 'Motif',
      statutOuvert: 'Ouvert',
      statutTraite: 'Traité',
    })
  })

  it('n’expose aucune valeur vide (un libellé manquant casserait un bandeau)', () => {
    for (const texte of Object.values(TEXTES)) {
      expect(texte.length).toBeGreaterThan(0)
    }
  })
})

describe('libelleStatutSignalement (Vague 3, écran admin)', () => {
  it("traduit l'enum Prisma sans jamais restituer le nom brut du statut", () => {
    expect(libelleStatutSignalement('ouvert')).toBe(TEXTES.statutOuvert)
    expect(libelleStatutSignalement('ouvert')).toBe('Ouvert')
    expect(libelleStatutSignalement('traite')).toBe(TEXTES.statutTraite)
    expect(libelleStatutSignalement('traite')).toBe('Traité')
    // Le nom brut de l'enum ne doit jamais atteindre l'écran.
    expect(libelleStatutSignalement('traite')).not.toBe('traite')
  })
})

describe('varianteStatutConversation (table de décision M8)', () => {
  it('colorie la FIN de conversation : acceptee=ok, refusee=danger, retiree=neutral', () => {
    expect(varianteStatutConversation('acceptee')).toBe('ok')
    expect(varianteStatutConversation('refusee')).toBe('danger')
    expect(varianteStatutConversation('retiree')).toBe('neutral')
  })

  it('affiche en brand toute conversation encore ouverte (4 statuts actifs)', () => {
    // Une seule variante pour le flux vivant : la couleur ne distingue que
    // les issues finales, pas l'avancement (voir chips M7 pour ça).
    expect(varianteStatutConversation('envoyee')).toBe('brand')
    expect(varianteStatutConversation('consultee')).toBe('brand')
    expect(varianteStatutConversation('preselectionnee')).toBe('brand')
    expect(varianteStatutConversation('entretien')).toBe('brand')
  })
})

describe('texteMotifLectureSeule (bandeau des 4 motifs)', () => {
  it('renvoie les 4 textes DISTINCTS, un par motif', () => {
    const textes = [
      texteMotifLectureSeule('acceptee'),
      texteMotifLectureSeule('refusee'),
      texteMotifLectureSeule('retiree'),
      texteMotifLectureSeule('bloque'),
    ]
    expect(new Set(textes).size).toBe(4)
  })

  it('réutilise la table TEXTES (jamais un texte recopié ici)', () => {
    expect(texteMotifLectureSeule('acceptee')).toBe(TEXTES.lectureSeuleAcceptee)
    expect(texteMotifLectureSeule('refusee')).toBe(TEXTES.lectureSeuleRefusee)
    expect(texteMotifLectureSeule('retiree')).toBe(TEXTES.lectureSeuleRetiree)
    // Le blocage d'interlocuteur est un motif INDEPENDANT du statut : il a
    // son propre texte (il n'affirme rien sur la candidature).
    expect(texteMotifLectureSeule('bloque')).toBe(TEXTES.ecritureBloquee)
  })

  it('couvre exactement les 4 motifs de la table ci-dessus', () => {
    // Les motifs « statut » de la table de référence (qui pilote les tests
    // exhaustifs ci-dessus, lesquels appellent bien les fonctions) sont
    // EXACTEMENT les statuts terminaux ; « bloque » est le seul motif hors
    // statut — et il a son propre texte (test « réutilise la table TEXTES »).
    const motifsStatut = Object.values(ATTENDU)
      .map((cas) => cas.motif)
      .filter((motif): motif is 'acceptee' | 'refusee' | 'retiree' => motif !== null)
    expect([...new Set(motifsStatut)].sort()).toEqual([...STATUTS_TERMINAIRES].sort())
  })
})
