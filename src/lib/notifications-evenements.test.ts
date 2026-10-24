import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StatutCandidature } from '@prisma/client'
import type { Prisma as NsPrisma } from '@prisma/client'

import { emettreNotification } from './notifications-emission'
import {
  notifierCandidatureRecue,
  notifierCandidatureRetiree,
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

const { offreFindUnique, conversationFindUnique, userFindUnique, userFindMany, candidatureFindMany } =
  vi.hoisted(() => ({
    offreFindUnique: vi.fn<(args: ArgsOffreFindUnique) => Promise<unknown>>(),
    conversationFindUnique: vi.fn<(args: ArgsConversationFindUnique) => Promise<unknown>>(),
    userFindUnique: vi.fn<(args: ArgsUserFindUnique) => Promise<unknown>>(),
    userFindMany: vi.fn<(args: ArgsUserFindMany) => Promise<unknown>>(),
    candidatureFindMany: vi.fn<(args: ArgsCandidatureFindMany) => Promise<unknown>>(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findUnique: offreFindUnique },
    conversation: { findUnique: conversationFindUnique },
    user: { findUnique: userFindUnique, findMany: userFindMany },
    candidature: { findMany: candidatureFindMany },
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
  emettre.mockClear()
  offreFindUnique.mockResolvedValue(OFFRE)
  conversationFindUnique.mockResolvedValue({
    candidature: { candidatId: 10, offre: OFFRE },
  })
  userFindUnique.mockResolvedValue({ name: 'Marie Dupont' })
  userFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
  candidatureFindMany.mockResolvedValue([{ candidatId: 10 }, { candidatId: 11 }])
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

describe('notifierStatutChange (candidat = destinataire, libellé source unique)', () => {
  it('notifie le CANDIDAT avec LIBELLES_STATUT[nouveauStatut], refId = candidatureId', async () => {
    await notifierStatutChange({
      candidatureId: 5,
      offreId: 3,
      candidatId: 10,
      ancienStatut: 'envoyee' as StatutCandidature,
      nouveauStatut: 'acceptee' as StatutCandidature,
      acteurId: 50,
    })

    const args = emettre.mock.calls[0]?.[0]
    expect(args?.destinataireId).toBe(10)
    expect(args?.type).toBe('statutCandidature')
    expect(args?.refId).toBe(5)
    expect(args?.lien).toBe('/candidat/candidatures/5')
    // Le libellé vient du tableau M7, jamais d'une phrase du résolveur.
    expect(args?.variables).toMatchObject({ libelleStatut: 'Acceptée' })
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
  it('candidat émetteur → notification au recruteur (entreprise.userId)', async () => {
    conversationFindUnique.mockResolvedValue({
      candidature: { candidatId: 10, offre: OFFRE },
    })

    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 10 })

    const args = emettre.mock.calls[0]?.[0]
    expect(args?.destinataireId).toBe(50)
    expect(args?.type).toBe('nouveauMessage')
    expect(args?.refId).toBe(7)
    expect(args?.lien).toBe('/messages/7')
    expect(args?.variables).toMatchObject({ type: 'nouveauMessage', acteur: 'Marie Dupont' })
  })

  it('recruteur émetteur → notification au candidat', async () => {
    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 50 })

    expect(emettre.mock.calls[0]?.[0]?.destinataireId).toBe(10)
  })

  it('auto-notification écartée (recruteur postulant à sa propre offre)', async () => {
    // Les deux participants DÉRIVENT de la candidature et valent le même id.
    conversationFindUnique.mockResolvedValue({
      candidature: { candidatId: 50, offre: OFFRE },
    })

    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 50 })

    expect(emettre).not.toHaveBeenCalled()
  })

  it('conversation ou émetteur inconnus → aucune émission', async () => {
    conversationFindUnique.mockResolvedValue(null)
    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 10 })
    expect(emettre).not.toHaveBeenCalled()

    conversationFindUnique.mockResolvedValue({
      candidature: { candidatId: 10, offre: OFFRE },
    })
    userFindUnique.mockResolvedValue(null)
    await notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 10 })
    expect(emettre).not.toHaveBeenCalled()
  })
})

// ─── signalementRecu ────────────────────────────────────────────────────────

describe('notifierSignalementRecu (chaque admin, modération)', () => {
  it('notifie CHAQUE admin, refId = messageId, lien admin', async () => {
    await notifierSignalementRecu({ messageId: 9, auteurId: 10 })

    expect(emettre).toHaveBeenCalledTimes(2)
    expect(emettre.mock.calls.map((appel) => appel[0]?.destinataireId)).toEqual([1, 2])
    for (const appel of emettre.mock.calls) {
      expect(appel[0]?.type).toBe('signalementRecu')
      expect(appel[0]?.refId).toBe(9)
      expect(appel[0]?.lien).toBe('/admin/signalements')
    }
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

describe('notifierOffreIndisponible (chaque candidat distinct)', () => {
  it('notifie chaque candidat distinct, refId = offreId (regroupement clôture/suppression)', async () => {
    await notifierOffreIndisponible({ offreId: 3 })

    // distinct candidatId dans la requête (un candidat = une notif par offre).
    expect(candidatureFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { offreId: 3 },
      distinct: ['candidatId'],
    })
    expect(emettre.mock.calls.map((appel) => appel[0]?.destinataireId)).toEqual([10, 11])
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

    await expect(
      notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 }),
    ).resolves.toBeUndefined()
    await expect(
      notifierMessageEnvoye({ conversationId: 7, messageId: 9, emetteurId: 10 }),
    ).resolves.toBeUndefined()
    await expect(
      notifierSignalementRecu({ messageId: 9, auteurId: 10 }),
    ).resolves.toBeUndefined()

    expect(emettre).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledTimes(3)
  })

  it('aucun trace en production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    offreFindUnique.mockRejectedValue(new Error('réseau'))

    await notifierCandidatureRecue({ candidatureId: 5, offreId: 3, candidatId: 10 })

    expect(console.error).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
