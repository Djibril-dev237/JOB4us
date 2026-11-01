import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StatutCandidature } from '@prisma/client'
import type { Prisma as NsPrisma } from '@prisma/client'

import { emettreNotification } from './notifications-emission'
import {
  notifierCandidatureRecue,
  notifierCandidatureRetiree,
  notifierDecisionModeration,
  notifierMessageEnvoye,
  notifierOffreIndisponible,
  notifierOffrePubliee,
  notifierSignalementRecu,
  notifierStatutChange,
} from './notifications-evenements'

// ─── Tests des résolveurs événement → émission (M9, Vague 2) ────────────────
// Cinq critères verrouillés ici :
// 1. DÉDUCTION DES DESTINATAIRES : recruteur = propriétaire courant de
//    l'offre (userId via entreprise), candidat = postulant, message = AUTRE
//    participant, signalement = CHAQUE admin — jamais l'acteur notifié pour
//    son propre acte (auto-notification écartée) ;
// 2. SOURCES MÈRES : refId = candidatureId / conversationId / messageId /
//    offreId (jamais de temps) → l'idempotence du cœur est préservée ;
// 3. LIBELLÉS : statut via LIBELLES_STATUT (source unique M7) ;
// 4. OFFRE ABSENTE → aucune émission (pas de notification orpheline) ;
// 5. JAMAIS BLOQUANT : une lecture qui lève n'atteint JAMAIS
//    emettreNotification et ne propage rien.
// ---------------------------------------------------------------------------

interface ArgsOffreFindUnique {
  where?: NsPrisma.OffreWhereUniqueInput
  select?: NsPrisma.OffreSelect
}
interface ArgsConversationFindUnique {
  where?: NsPrisma.ConversationWhereUniqueInput
  select?: NsPrisma.ConversationSelect
}
interface ArgsUserFindUnique {
  where?: NsPrisma.UserWhereUniqueInput
  select?: NsPrisma.UserSelect
}
interface ArgsUserFindMany {
  where?: NsPrisma.UserWhereInput
  select?: NsPrisma.UserSelect
}
interface ArgsCandidatureFindMany {
  where?: NsPrisma.CandidatureWhereInput
  select?: NsPrisma.CandidatureSelect
  distinct?: ('candidatId')[]
}
interface ArgsCandidatureFindUnique {
  where?: NsPrisma.CandidatureWhereUniqueInput
  select?: NsPrisma.CandidatureSelect
}

const {
  offreFindUnique,
  conversationFindUnique,
  userFindUnique,
  userFindMany,
  candidatureFindMany,
  candidatureFindUnique,
} = vi.hoisted(() => ({
  offreFindUnique: vi.fn<(args: ArgsOffreFindUnique) => Promise<unknown>>(),
  conversationFindUnique: vi.fn<(args: ArgsConversationFindUnique) => Promise<unknown>>(),
  userFindUnique: vi.fn<(args: ArgsUserFindUnique) => Promise<unknown>>(),
  userFindMany: vi.fn<(args: ArgsUserFindMany) => Promise<unknown>>(),
  candidatureFindMany: vi.fn<(args: ArgsCandidatureFindMany) => Promise<unknown>>(),
  candidatureFindUnique: vi.fn<(args: ArgsCandidatureFindUnique) => Promise<unknown>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findUnique: offreFindUnique },
    conversation: { findUnique: conversationFindUnique },
    user: { findUnique: userFindUnique, findMany: userFindMany },
    candidature: {
      findMany: candidatureFindMany,
      findUnique: candidatureFindUnique,
    },
  },
}))

vi.mock('./notifications-emission', () => ({
  emettreNotification: vi.fn(async () => ({ notificationId: 1 })),
}))

const emettre = vi.mocked(emettreNotification)

const OFFRE = {
  titre: 'Développeur',
  slug: 'developpeur',
  entreprise: { userId: 50 },
}

beforeEach(() => {
  offreFindUnique.mockReset()
  conversationFindUnique.mockReset()
  userFindUnique.mockReset()
  userFindMany.mockReset()
  candidatureFindMany.mockReset()
  candidatureFindUnique.mockReset()
  emettre.mockClear()
  offreFindUnique.mockResolvedValue(OFFRE)
  conversationFindUnique.mockResolvedValue({
    candidature: { candidat: { userId: 70 }, offre: OFFRE },
  })
  userFindUnique.mockResolvedValue({ name: 'Marie Dupont' })
  userFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
  candidatureFindMany.mockResolvedValue([
    { candidatId: 10, candidat: { userId: 70 } },
    { candidatId: 11, candidat: { userId: 71 } },
  ])
  candidatureFindUnique.mockResolvedValue({
    candidat: { userId: 70 },
    offre: { titre: 'Développeur' },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear()
})

// ─── candidatureRecue ───────────────────────────────────────────────────────

describe('notifierCandidatureRecue (recruteur = propriétaire courant)', () => {
  it('notifie le propriétaire de l’offre, refId = candidatureId, lien détail recruteur', async () => {
    await notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 })

    expect(emettre).toHaveBeenCalledWith({
      destinataireId: 50,
      type: 'candidatureRecue',
      refId: 5,
      lien: '/recruteur/candidatures/5',
      variables: { type: 'candidatureRecue', titreOffre: 'Développeur' },
    })
  })

  it('offre absente → aucune émission (jamais de notification orpheline)', async () => {
    offreFindUnique.mockResolvedValue(null)

    await notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 })

    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── statutChange ───────────────────────────────────────────────────────────

describe('notifierStatutChange (compte candidat = destinataire, libellé source unique)', () => {
  it('résout Candidat.id → User.id et notifie le CANDIDAT, refId = candidatureId', async () => {
    await notifierStatutChange({
      candidatureId: 5,
      offreId: 3,
      // Candidat.id (profil), volontairement différent du User.id (70).
      candidatId: 10,
      ancienStatut: 'envoyee' as StatutCandidature,
      nouveauStatut: 'acceptee' as StatutCandidature,
      acteurId: 50,
    })

    expect(candidatureFindUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: {
        candidat: { select: { userId: true } },
        offre: { select: { titre: true } },
      },
    })
    const args = emettre.mock.calls[0]?.[0]
    expect(args?.destinataireId).toBe(70)
    expect(args?.type).toBe('statutCandidature')
    expect(args?.refId).toBe(5)
    expect(args?.lien).toBe('/candidat/candidatures/5')
    // Le libellé vient du tableau M7, jamais d'une phrase du résolveur.
    expect(args?.variables).toMatchObject({ libelleStatut: 'Acceptée' })
  })

  it('candidature absente → aucune émission', async () => {
    candidatureFindUnique.mockResolvedValue(null)

    await notifierStatutChange({
      candidatureId: 5,
      offreId: 3,
      candidatId: 10,
      ancienStatut: 'envoyee' as StatutCandidature,
      nouveauStatut: 'acceptee' as StatutCandidature,
      acteurId: 50,
    })

    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── candidatureRetiree ─────────────────────────────────────────────────────

describe('notifierCandidatureRetiree (recruteur = propriétaire courant)', () => {
  it('notifie le recruteur, refId = candidatureId, lien liste recruteur', async () => {
    await notifierCandidatureRetiree({ candidatureId: 5, offreId: 3, candidatId: 10 })

    expect(emettre).toHaveBeenCalledWith({
      destinataireId: 50,
      type: 'candidatureRetiree',
      refId: 5,
      lien: '/recruteur/candidatures',
      variables: { type: 'candidatureRetiree', titreOffre: 'Développeur' },
    })
  })
})

// ─── messageEnvoye ──────────────────────────────────────────────────────────

describe('notifierMessageEnvoye (autre participant, jamais soi-même)', () => {
  it('candidat émetteur (User.id) → notification au recruteur (entreprise.userId)', async () => {
    conversationFindUnique.mockResolvedValue({
      candidature: { candidat: { userId: 70 }, offre: OFFRE },
    })

    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 70 })

    const args = emettre.mock.calls[0]?.[0]
    expect(args?.destinataireId).toBe(50)
    expect(args?.type).toBe('nouveauMessage')
    expect(args?.refId).toBe(7)
    expect(args?.lien).toBe('/messages/7')
    expect(args?.variables).toMatchObject({ type: 'nouveauMessage', acteur: 'Marie Dupont' })
  })

  it('recruteur émetteur → notification au COMPTE du candidat, jamais au Candidat.id', async () => {
    conversationFindUnique.mockResolvedValue({
      // Candidat.id = 10, User.id = 70 : seul le second est un destinataire.
      candidature: { candidatId: 10, candidat: { userId: 70 }, offre: OFFRE },
    })

    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 50 })

    expect(emettre.mock.calls[0]?.[0]?.destinataireId).toBe(70)
  })

  it('auto-notification écartée (recruteur postulant à sa propre offre)', async () => {
    // Les deux participants DÉRIVENT de la candidature et valent le même User.id.
    conversationFindUnique.mockResolvedValue({
      candidature: { candidat: { userId: 50 }, offre: OFFRE },
    })

    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 50 })

    expect(emettre).not.toHaveBeenCalled()
  })

  it('conversation ou émetteur inconnus → aucune émission', async () => {
    conversationFindUnique.mockResolvedValue(null)
    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 70 })
    expect(emettre).not.toHaveBeenCalled()

    conversationFindUnique.mockResolvedValue({
      candidature: { candidat: { userId: 70 }, offre: OFFRE },
    })
    userFindUnique.mockResolvedValue(null)
    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 70 })
    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── signalementRecu ────────────────────────────────────────────────────────

describe('notifierSignalementRecu (chaque admin actif, modération)', () => {
  it('notifie CHAQUE admin actif, refId = messageId, lien admin', async () => {
    await notifierSignalementRecu({ messageId: 9, auteurId: 10 })

    expect(userFindMany).toHaveBeenCalledWith({
      where: { role: 'admin', isActive: true },
      select: { id: true },
    })
    expect(emettre).toHaveBeenCalledTimes(2)
    expect(emettre.mock.calls.map((appel) => appel[0]?.destinataireId)).toEqual([1, 2])
    for (const appel of emettre.mock.calls) {
      expect(appel[0]?.type).toBe('signalementRecu')
      expect(appel[0]?.refId).toBe(9)
      expect(appel[0]?.lien).toBe('/admin/signalements')
    }
  })

  it('aucun admin actif : aucune notification', async () => {
    userFindMany.mockResolvedValue([])

    await notifierSignalementRecu({ messageId: 9, auteurId: 10 })

    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── moderation ─────────────────────────────────────────────────────────────

describe('notifierDecisionModeration (auteur du signalement, décision fermée)', () => {
  it('notifie l’auteur avec la décision, refId = signalementId', async () => {
    await notifierDecisionModeration({
      signalementId: 7,
      auteurId: 10,
      decision: 'masquage',
    })

    expect(emettre).toHaveBeenCalledWith({
      destinataireId: 10,
      type: 'moderation',
      refId: 7,
      lien: '/notifications',
      variables: { type: 'moderation', decision: 'masquage' },
    })
  })

  it('aucun contenu privé dans le payload', async () => {
    await notifierDecisionModeration({
      signalementId: 7,
      auteurId: 10,
      decision: 'suspension',
    })

    const payload = emettre.mock.calls[0]?.[0]
    expect(payload?.variables).toEqual({ type: 'moderation', decision: 'suspension' })
  })
})

// ─── offrePubliee ───────────────────────────────────────────────────────────

describe('notifierOffrePubliee (chaque admin, lien public)', () => {
  it('notifie chaque admin avec le lien public /offres/{slug}, refId = offreId', async () => {
    await notifierOffrePubliee({ offreId: 3 })

    expect(emettre).toHaveBeenCalledTimes(2)
    for (const appel of emettre.mock.calls) {
      expect(appel[0]?.type).toBe('offrePubliee')
      expect(appel[0]?.refId).toBe(3)
      expect(appel[0]?.lien).toBe('/offres/developpeur')
      expect(appel[0]?.variables).toEqual({
        type: 'offrePubliee',
        titreOffre: 'Développeur',
      })
    }
  })
})

// ─── offreIndisponible ──────────────────────────────────────────────────────

describe('notifierOffreIndisponible (chaque compte candidat distinct)', () => {
  it('résout chaque Candidat.id → User.id, refId = offreId (regroupement clôture/suppression)', async () => {
    await notifierOffreIndisponible({ offreId: 3 })

    // distinct candidatId dans la requête (un candidat = une notif par offre),
    // et jointure du COMPTE : Notification.userId attend User.id.
    expect(candidatureFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { offreId: 3 },
      select: {
        candidatId: true,
        candidat: { select: { userId: true } },
      },
      distinct: ['candidatId'],
    })
    expect(emettre.mock.calls.map((appel) => appel[0]?.destinataireId)).toEqual([70, 71])
    for (const appel of emettre.mock.calls) {
      expect(appel[0]?.type).toBe('offreIndisponible')
      expect(appel[0]?.refId).toBe(3)
      expect(appel[0]?.lien).toBe('/candidat/candidatures')
    }
  })

  it('aucun candidat → zéro émission, zéro boucle', async () => {
    candidatureFindMany.mockResolvedValue([])

    await notifierOffreIndisponible({ offreId: 3 })

    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── Jamais bloquant ────────────────────────────────────────────────────────

describe('échecs de lecture avalés (contrat no-throw des hooks)', () => {
  it('une lecture qui lève n’atteint jamais emettreNotification', async () => {
    offreFindUnique.mockRejectedValue(new Error('réseau'))
    conversationFindUnique.mockRejectedValue(new Error('réseau'))
    userFindMany.mockRejectedValue(new Error('réseau'))
    candidatureFindUnique.mockRejectedValue(new Error('réseau'))

    await expect(
      notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 }),
    ).resolves.toBeUndefined()
    await expect(
      notifierStatutChange({
        candidatureId: 5,
        offreId: 3,
        candidatId: 10,
        ancienStatut: 'envoyee' as StatutCandidature,
        nouveauStatut: 'acceptee' as StatutCandidature,
        acteurId: 50,
      }),
    ).resolves.toBeUndefined()
    await expect(
      notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 70 }),
    ).resolves.toBeUndefined()
    await expect(
      notifierSignalementRecu({ messageId: 9, auteurId: 10 }),
    ).resolves.toBeUndefined()

    expect(emettre).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(4)
  })

  it('aucun trace en production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    offreFindUnique.mockRejectedValue(new Error('réseau'))

    await notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 })

    expect(console.error).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
