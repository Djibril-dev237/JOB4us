import type { StatutCandidature, StatutOffre } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma as NsPrisma } from '@prisma/client'

import { PAGE, avancerLecture, chargerConversation, listerConversations, lireMessagesParCurseur, poserMasque } from './messagerie-dal'

// ─── Tests de la couche de données MESSAGERIE (M8, Vague 1) ─────────────────
// Trois critères verrouillés ici :
// 1. le contrôle de participation est porté par le `where` de la LECTURE
//    elle-même (MÊME requête Prisma) et rend `null` dans TOUS les cas non
//    trouvés — 404 indiscernable côté appelant, aucun indice différentié ;
// 2. `listerConversations` émet un nombre de requêtes FIXE (3 max), quel
//    que soit le nombre de conversations : N+1 strictement interdit ;
// 3. `avancerLecture` n'avance `luLe` QUE s'il progresse (CAS porté par le
//    `where` du updateMany) — pas de faux avancement, pas de regression.
//
// Patron repris de offres-dal.test.ts : vi.hoisted + vi.mock('@/lib/prisma')
// n'exposant QUE les méthodes testées — toute requête supplémentaire du DAL
// lèverait une TypeError et casserait le test (c'est ainsi qu'on prouve le
// comptage fixe des requêtes).
// ---------------------------------------------------------------------------

// ─── Args des doubles (zéro `any` : lecture des arguments réels) ────────────

interface ArgsConversationFindFirst {
  where?: NsPrisma.ConversationWhereInput
  include?: NsPrisma.ConversationInclude
}

interface ArgsConversationFindMany {
  where?: NsPrisma.ConversationWhereInput
  include?: NsPrisma.ConversationInclude
  orderBy?: NsPrisma.ConversationOrderByWithRelationInput
}

interface ArgsMessageFindMany {
  where?: NsPrisma.MessageWhereInput
  select?: NsPrisma.MessageSelect
  orderBy?: NsPrisma.MessageOrderByWithRelationInput
  take?: number
}

interface ArgsMessageFindFirst {
  where?: NsPrisma.MessageWhereInput
  orderBy?: NsPrisma.MessageOrderByWithRelationInput
  select?: NsPrisma.MessageSelect
}

interface ArgsEtatFindMany {
  where?: NsPrisma.ConversationEtatWhereInput
  select?: NsPrisma.ConversationEtatSelect
}

interface ArgsEtatUpdateMany {
  where?: NsPrisma.ConversationEtatWhereInput
  data?: NsPrisma.ConversationEtatUpdateManyMutationInput
}

interface ArgsEtatFindUnique {
  where?: { conversationId_userId: { conversationId: number; userId: number } }
  select?: NsPrisma.ConversationEtatSelect
}

interface ArgsEtatCreate {
  data?: NsPrisma.ConversationEtatUncheckedCreateInput
}

interface ArgsEtatUpsert {
  where?: { conversationId_userId: { conversationId: number; userId: number } }
  create?: NsPrisma.ConversationEtatUncheckedCreateInput
  update?: NsPrisma.ConversationEtatUncheckedUpdateInput
}

// Lignes simulées (payload retourné par le mock, jamais `any`).

interface UserSim {
  id: number
  name: string
}

interface OffreSim {
  id: number
  titre: string
  statut: StatutOffre
  deletedAt: Date | null
  entreprise: { userId: number; user: UserSim }
}

interface CandidatureSim {
  id: number
  offreId: number
  statut: StatutCandidature
  candidat: { userId: number; user: UserSim }
  offre: OffreSim
}

interface MessageSim {
  id: number
  contenu: string
  senderId: number
  createdAt: Date
}

interface ConversationSim {
  id: number
  candidatureId: number
  candidature: CandidatureSim
  messages?: MessageSim[]
}

const {
  conversationFindFirst,
  conversationFindMany,
  messageFindFirst,
  messageFindMany,
  etatFindMany,
  etatUpdateMany,
  etatFindUnique,
  etatCreate,
  etatUpsert,
} = vi.hoisted(() => ({
  conversationFindFirst: vi.fn<(args: ArgsConversationFindFirst) => Promise<unknown>>(),
  conversationFindMany: vi.fn<(args: ArgsConversationFindMany) => Promise<unknown>>(),
  messageFindFirst: vi.fn<(args: ArgsMessageFindFirst) => Promise<unknown>>(),
  messageFindMany: vi.fn<(args: ArgsMessageFindMany) => Promise<unknown>>(),
  etatFindMany: vi.fn<(args: ArgsEtatFindMany) => Promise<unknown>>(),
  etatUpdateMany: vi.fn<(args: ArgsEtatUpdateMany) => Promise<{ count: number }>>(),
  etatFindUnique: vi.fn<(args: ArgsEtatFindUnique) => Promise<unknown>>(),
  etatCreate: vi.fn<(args: ArgsEtatCreate) => Promise<unknown>>(),
  etatUpsert: vi.fn<(args: ArgsEtatUpsert) => Promise<unknown>>(),
}))

// Seules les méthodes du DAL sont exposées : une requête de plus (un findMany
// par ligne, un count…) casserait le test par TypeError — c'est la preuve
// mécanique du comptage fixe des requêtes.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: conversationFindFirst, findMany: conversationFindMany },
    message: { findFirst: messageFindFirst, findMany: messageFindMany },
    conversationEtat: {
      findMany: etatFindMany,
      updateMany: etatUpdateMany,
      findUnique: etatFindUnique,
      create: etatCreate,
      upsert: etatUpsert,
    },
  },
}))

// ─── Fixtures ───────────────────────────────────────────────────────────────

const CONV_ID = 5
const CANDIDAT_USER_ID = 11
const RECRUTEUR_USER_ID = 22

/** Conversation « candidat postulant à une offre publiee ». */
function convCandidat(overrides?: Partial<ConversationSim>): ConversationSim {
  return {
    id: CONV_ID,
    candidatureId: 9,
    candidature: {
      id: 9,
      offreId: 3,
      statut: 'envoyee',
      candidat: { userId: CANDIDAT_USER_ID, user: { id: CANDIDAT_USER_ID, name: 'Awa' } },
      offre: {
        id: 3,
        titre: 'Developpeur back-end',
        statut: 'publiee',
        deletedAt: null,
        entreprise: { userId: RECRUTEUR_USER_ID, user: { id: RECRUTEUR_USER_ID, name: 'ACME' } },
      },
    },
    // Prisma renvoie TOUJOURS un tableau (éventuellement vide) pour un
    // include relationnel — la fixture reproduit ce contrat.
    messages: [],
    ...overrides,
  }
}

/** `where` participant attendu (partie OR — commun à toutes les lectures). */
function ouParticipant(userId: number): { OR: Record<string, unknown>[] } {
  return { OR: [{ candidat: { userId } }, { offre: { entreprise: { userId } } }] }
}

beforeEach(() => {
  conversationFindFirst.mockReset()
  conversationFindMany.mockReset()
  messageFindFirst.mockReset()
  messageFindMany.mockReset()
  etatFindMany.mockReset()
  etatUpdateMany.mockReset()
  etatFindUnique.mockReset()
  etatCreate.mockReset()
  etatUpsert.mockReset()
  conversationFindFirst.mockResolvedValue(null)
  conversationFindMany.mockResolvedValue([])
  messageFindFirst.mockResolvedValue(null)
  messageFindMany.mockResolvedValue([])
  etatFindMany.mockResolvedValue([])
  etatUpdateMany.mockResolvedValue({ count: 0 })
  etatFindUnique.mockResolvedValue(null)
  etatCreate.mockResolvedValue(null)
  etatUpsert.mockResolvedValue(null)
})

// ─── chargerConversation ────────────────────────────────────────────────────

describe('chargerConversation (participation dans la MÊME requête)', () => {
  it('id inexistant → null, avec le where participant complet en UNE seule requête', async () => {
    expect(await chargerConversation(CONV_ID, CANDIDAT_USER_ID)).toBeNull()

    expect(conversationFindFirst).toHaveBeenCalledTimes(1)
    expect(conversationFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: CONV_ID,
      candidature: ouParticipant(CANDIDAT_USER_ID),
    })
  })

  it('candidat NON-participant → null (même verdict qu’une conversation absente)', async () => {
    // Le mock ne renvoie rien : c’est exactement ce que la vraie requête
    // produirait pour un étranger — et la CLÉ du test, c’est que le `where`
    // envoyé à la base PORTE déjà la participation.
    conversationFindFirst.mockResolvedValue(null)

    expect(await chargerConversation(CONV_ID, 999)).toBeNull()

    expect(conversationFindFirst).toHaveBeenCalledTimes(1)
    expect(conversationFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: CONV_ID,
      candidature: ouParticipant(999),
    })
  })

  it('recruteur NON-participant → null, mêmes clés de where (aucun indice distinct)', async () => {
    conversationFindFirst.mockResolvedValue(null)

    expect(await chargerConversation(999, CANDIDAT_USER_ID)).toBeNull()

    const args = conversationFindFirst.mock.calls[0]?.[0]
    expect(Object.keys(args?.where ?? {}).sort()).toEqual(['candidature', 'id'])
    expect(args?.where).toEqual({ id: 999, candidature: ouParticipant(CANDIDAT_USER_ID) })
  })

  it('participant CANDIDAT → moi candidat, autre recruteur (noms dérivés)', async () => {
    conversationFindFirst.mockResolvedValue(convCandidat())

    const conversation = await chargerConversation(CONV_ID, CANDIDAT_USER_ID)

    expect(conversation).not.toBeNull()
    expect(conversation?.moi).toEqual({ userId: CANDIDAT_USER_ID, role: 'candidat', nom: 'Awa' })
    expect(conversation?.autre).toEqual({ userId: RECRUTEUR_USER_ID, role: 'recruteur', nom: 'ACME' })
    expect(conversation?.candidatureId).toBe(9)
    expect(conversation?.offreId).toBe(3)
    expect(conversation?.statutCandidature).toBe('envoyee')
    expect(conversation?.titreOffre).toBe('Developpeur back-end')
  })

  it('participant RECRUTEUR → moi recruteur, autre candidat (et inverse des rôles)', async () => {
    conversationFindFirst.mockResolvedValue(convCandidat())

    const conversation = await chargerConversation(CONV_ID, RECRUTEUR_USER_ID)

    expect(conversation?.moi).toEqual({ userId: RECRUTEUR_USER_ID, role: 'recruteur', nom: 'ACME' })
    expect(conversation?.autre).toEqual({ userId: CANDIDAT_USER_ID, role: 'candidat', nom: 'Awa' })
    expect(conversationFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: CONV_ID,
      candidature: ouParticipant(RECRUTEUR_USER_ID),
    })
  })

  it('offre SUSPENDUE → titreOffre null (aucune fuite par le canal messagerie)', async () => {
    const conversation = convCandidat()
    conversation.candidature.offre.statut = 'suspendue'
    conversationFindFirst.mockResolvedValue(conversation)

    expect((await chargerConversation(CONV_ID, CANDIDAT_USER_ID))?.titreOffre).toBeNull()
  })

  it('offre SUPPRIMÉE logiquement → titreOffre null (même anti-fuite)', async () => {
    const conversation = convCandidat()
    conversation.candidature.offre.deletedAt = new Date('2026-09-01T00:00:00Z')
    conversationFindFirst.mockResolvedValue(conversation)

    expect((await chargerConversation(CONV_ID, CANDIDAT_USER_ID))?.titreOffre).toBeNull()
  })

  it('offre publiée ET non supprimée → le titre est rendu (seul cas)', async () => {
    conversationFindFirst.mockResolvedValue(convCandidat())

    expect((await chargerConversation(CONV_ID, CANDIDAT_USER_ID))?.titreOffre).toBe(
      'Developpeur back-end',
    )
  })
})

// ─── listerConversations ────────────────────────────────────────────────────

describe('listerConversations (3 requêtes fixes, aucun N+1)', () => {
  it('masque MA conversation → exclue ; exactement 3 requêtes au total', async () => {
    const visible = convCandidat()
    const masquee = convCandidat({ id: 6, candidatureId: 10 })
    conversationFindMany.mockResolvedValue([visible, masquee])
    // Mon état : la conv 6 est masquée de mon côté, la 5 ne l’est pas.
    etatFindMany.mockResolvedValue([
      { conversationId: 6, luLe: null, masqueLe: new Date('2026-10-01T00:00:00Z'), userId: CANDIDAT_USER_ID },
      { conversationId: 5, luLe: null, masqueLe: null, userId: CANDIDAT_USER_ID },
    ])

    const lignes = await listerConversations(CANDIDAT_USER_ID, 'candidat')

    expect(lignes.map((ligne) => ligne.conversationId)).toEqual([5])

    // 3 requêtes fixes : une par modèle, AUCUNE de plus.
    expect(conversationFindMany).toHaveBeenCalledTimes(1)
    expect(etatFindMany).toHaveBeenCalledTimes(1)
    expect(messageFindMany).toHaveBeenCalledTimes(1)

    // Filtre rôle candidat + exclusion des masquées portés par le WHERE
    // (rien n’est filtré après coup au prix d’une requête de plus).
    expect(conversationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      candidature: { candidat: { userId: CANDIDAT_USER_ID } },
      etats: { none: { userId: CANDIDAT_USER_ID, masqueLe: { not: null } } },
    })
    // Le dernier message est embarqué dans la requête 1 (take 1), pas lu
    // par requête.
    const include = conversationFindMany.mock.calls[0]?.[0]?.include
    expect(include).toMatchObject({
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    })
  })

  it('nonLus = messages de l’AUTRE après luLe ; les miens sont exclus par le where', async () => {
    const luLe = new Date('2026-10-05T12:00:00Z')
    conversationFindMany.mockResolvedValue([
      convCandidat({ messages: [{ id: 1, contenu: 'Bonjour', senderId: CANDIDAT_USER_ID, createdAt: luLe }] }),
    ])
    etatFindMany.mockResolvedValue([{ conversationId: CONV_ID, luLe, masqueLe: null }])
    messageFindMany.mockResolvedValue([
      { conversationId: CONV_ID, createdAt: new Date('2026-10-04T09:00:00Z') }, // avant luLe
      { conversationId: CONV_ID, createdAt: luLe }, // EXACTEMENT luLe → déjà lu
      { conversationId: CONV_ID, createdAt: new Date('2026-10-06T08:00:00Z') }, // après
    ])

    const lignes = await listerConversations(CANDIDAT_USER_ID, 'candidat')

    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.nonLus).toBe(1)

    // Les messages de l'AUTRE sont sélectionnés côté SQL : mes propres
    // messages ne peuvent même pas arriver (zéro transfert inutile).
    expect(messageFindMany.mock.calls[0]?.[0]?.where).toEqual({
      conversationId: { in: [CONV_ID] },
      senderId: { not: CANDIDAT_USER_ID },
    })
    // dernierMessage = la ligne embarquée (première en ordre décroissant).
    expect(lignes[0]?.dernierMessage).toEqual({
      contenu: 'Bonjour',
      emetteurId: CANDIDAT_USER_ID,
      createdAt: luLe,
    })
  })

  it('luLe null → TOUS les messages de l’autre comptent comme non lus', async () => {
    conversationFindMany.mockResolvedValue([convCandidat()])
    etatFindMany.mockResolvedValue([{ conversationId: CONV_ID, luLe: null, masqueLe: null }])
    messageFindMany.mockResolvedValue([
      { conversationId: CONV_ID, createdAt: new Date('2026-10-04T09:00:00Z') },
      { conversationId: CONV_ID, createdAt: new Date('2026-10-06T08:00:00Z') },
    ])

    const lignes = await listerConversations(CANDIDAT_USER_ID, 'candidat')

    expect(lignes[0]?.nonLus).toBe(2)
    // Aucune ligne d'état pour moi → aucune exclusion à appliquer.
    expect(etatFindMany.mock.calls[0]?.[0]?.where).toEqual({
      userId: CANDIDAT_USER_ID,
      conversationId: { in: [CONV_ID] },
    })
  })

  it('rôle RECRUTEUR → filtre par offre.entreprise.userId et nom du candidat', async () => {
    conversationFindMany.mockResolvedValue([convCandidat()])

    const lignes = await listerConversations(RECRUTEUR_USER_ID, 'recruteur')

    expect(conversationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      candidature: { offre: { entreprise: { userId: RECRUTEUR_USER_ID } } },
      etats: { none: { userId: RECRUTEUR_USER_ID, masqueLe: { not: null } } },
    })
    expect(lignes[0]?.nomInterlocuteur).toBe('Awa')
    expect(lignes[0]?.statutCandidature).toBe('envoyee')
    expect(lignes[0]?.titreOffre).toBe('Developpeur back-end')
  })

  it('aucune conversation → UNE seule requête (les deux autres sont sautées)', async () => {
    conversationFindMany.mockResolvedValue([])

    expect(await listerConversations(CANDIDAT_USER_ID, 'candidat')).toEqual([])

    expect(conversationFindMany).toHaveBeenCalledTimes(1)
    expect(etatFindMany).not.toHaveBeenCalled()
    expect(messageFindMany).not.toHaveBeenCalled()
  })
})

// ─── lireMessagesParCurseur ─────────────────────────────────────────────────

describe('lireMessagesParCurseur (pagination par curseur temporel)', () => {
  it('non-participant → null, avec le where participant dans LA requête', async () => {
    expect(await lireMessagesParCurseur(CONV_ID, 999, null)).toBeNull()

    expect(conversationFindFirst).toHaveBeenCalledTimes(1)
    expect(conversationFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: CONV_ID,
      candidature: ouParticipant(999),
    })
  })

  it('curseur fourni → where createdAt STRICTEMENT lt (aucun doublon de bord)', async () => {
    const curseur = new Date('2026-10-06T12:00:00Z')
    conversationFindFirst.mockResolvedValue(convCandidat({ messages: [] }))

    await lireMessagesParCurseur(CONV_ID, CANDIDAT_USER_ID, curseur)

    const include = conversationFindFirst.mock.calls[0]?.[0]?.include
    expect(include).toMatchObject({
      messages: {
        where: { createdAt: { lt: curseur } },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
      },
    })
  })

  it('31 bruts → 30 rendus en ordre CROISSANT + aPlusAncien true', async () => {
    const bruts = Array.from({ length: 31 }, (_, index) => ({
      id: 100 - index, // décroissant (ordre Prisma DESC)
      contenu: `m${100 - index}`,
      senderId: CANDIDAT_USER_ID,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 30 - index)),
    }))
    conversationFindFirst.mockResolvedValue(convCandidat({ messages: bruts }))

    const page = await lireMessagesParCurseur(CONV_ID, CANDIDAT_USER_ID, null)

    expect(page?.aPlusAncien).toBe(true)
    expect(page?.messages).toHaveLength(PAGE)
    // Croissant strict : du plus ancien au plus récent, en gardant les 30
    // PLUS RÉCENTS de la fenêtre (adjacents au curseur)…
    expect(page?.messages[0]?.id).toBe(71)
    expect(page?.messages[PAGE - 1]?.id).toBe(100)
    // …et en éjectant le 31e brut (id 70, le plus ancien) qui prouve
    // qu'une page plus ancienne existe.
    const dates = page?.messages.map((message) => message.createdAt.getTime()) ?? []
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
  })

  it('jonction des pages : aucune lacune entre la page 1 et la page 2', async () => {
    // Page 1 (sans curseur) : les 31 plus récents (100 → 70) → rend 71…100.
    const brutsPage1 = Array.from({ length: 31 }, (_, index) => ({
      id: 100 - index,
      contenu: `m${100 - index}`,
      senderId: CANDIDAT_USER_ID,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 30 - index)),
    }))
    // Page 2 (curseur = createdAt du message 71) : les 31 plus récents
    // strictement plus anciens (70 → 40) → rend 41…70.
    const brutsPage2 = Array.from({ length: 31 }, (_, index) => ({
      id: 70 - index,
      contenu: `m${70 - index}`,
      senderId: RECRUTEUR_USER_ID,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 0) - (index + 1) * 60_000),
    }))
    conversationFindFirst
      .mockResolvedValueOnce(convCandidat({ messages: brutsPage1 }))
      .mockResolvedValueOnce(convCandidat({ messages: brutsPage2 }))

    const page1 = await lireMessagesParCurseur(CONV_ID, CANDIDAT_USER_ID, null)
    const plancher = page1?.messages[0]?.createdAt ?? null
    const page2 = await lireMessagesParCurseur(CONV_ID, CANDIDAT_USER_ID, plancher)

    expect(page1?.messages[0]?.id).toBe(71)
    // Continuité stricte : la page 2 se termine exactement sous le plancher
    // de la page 1 (71 → 70), aucun message sauté ni rendu deux fois.
    expect(page2?.messages[PAGE - 1]?.id).toBe(70)
    expect(page2?.messages[0]?.id).toBe(41)
    expect(page2?.aPlusAncien).toBe(true)
  })

  it('sans curseur → dernière page propre (aPlusAncien false, aucun tri perdu)', async () => {
    const bruts = Array.from({ length: 5 }, (_, index) => ({
      id: 50 - index,
      contenu: `m${50 - index}`,
      senderId: RECRUTEUR_USER_ID,
      createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 5 - index)),
    }))
    conversationFindFirst.mockResolvedValue(convCandidat({ messages: bruts }))

    const page = await lireMessagesParCurseur(CONV_ID, CANDIDAT_USER_ID, null)

    expect(page?.aPlusAncien).toBe(false)
    expect(page?.messages.map((message) => message.id)).toEqual([46, 47, 48, 49, 50])
    expect(page?.messages.map((message) => message.emetteurId)).toEqual(
      Array.from({ length: 5 }, () => RECRUTEUR_USER_ID),
    )
    // Aucun where de curseur : la page la plus récente est demandée telle quelle.
    const include = conversationFindFirst.mock.calls[0]?.[0]?.include
    expect(include).toMatchObject({ messages: { where: undefined, take: PAGE + 1 } })
  })
})

// ─── avancerLecture ─────────────────────────────────────────────────────────

describe('avancerLecture (CAS anti-course sur luLe)', () => {
  const dernier = new Date('2026-10-06T08:00:00Z')

  it('aucun message → false et ZÉRO écriture (pas même une lecture d’état)', async () => {
    messageFindFirst.mockResolvedValue(null)

    expect(await avancerLecture(CONV_ID, CANDIDAT_USER_ID)).toBe(false)

    expect(messageFindFirst).toHaveBeenCalledTimes(1)
    expect(messageFindFirst.mock.calls[0]?.[0]).toEqual({
      where: { conversationId: CONV_ID },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    expect(etatUpdateMany).not.toHaveBeenCalled()
    expect(etatFindUnique).not.toHaveBeenCalled()
    expect(etatCreate).not.toHaveBeenCalled()
  })

  it('luLe déjà au dernier message → CAS à zéro + état présent → false, create interdit', async () => {
    messageFindFirst.mockResolvedValue({ createdAt: dernier })
    etatUpdateMany.mockResolvedValue({ count: 0 })
    etatFindUnique.mockResolvedValue({ conversationId: CONV_ID })

    expect(await avancerLecture(CONV_ID, CANDIDAT_USER_ID)).toBe(false)

    // Le where du updateMany PORTE la progressivité : c’est lui le CAS.
    expect(etatUpdateMany).toHaveBeenCalledTimes(1)
    expect(etatUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      conversationId: CONV_ID,
      userId: CANDIDAT_USER_ID,
      OR: [{ luLe: null }, { luLe: { lt: dernier } }],
    })
    expect(etatUpdateMany.mock.calls[0]?.[0]?.data).toEqual({ luLe: dernier })
    expect(etatCreate).not.toHaveBeenCalled()
  })

  it('luLe plus ancien → updateMany CAS (where exact) → true, aucun create', async () => {
    messageFindFirst.mockResolvedValue({ createdAt: dernier })
    etatUpdateMany.mockResolvedValue({ count: 1 })

    expect(await avancerLecture(CONV_ID, CANDIDAT_USER_ID)).toBe(true)

    expect(etatUpdateMany).toHaveBeenCalledTimes(1)
    expect(etatUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      conversationId: CONV_ID,
      userId: CANDIDAT_USER_ID,
      OR: [{ luLe: null }, { luLe: { lt: dernier } }],
    })
    expect(etatFindUnique).not.toHaveBeenCalled()
    expect(etatCreate).not.toHaveBeenCalled()
  })

  it('première lecture (aucune ligne d’état) → create avec luLe = dernier message → true', async () => {
    messageFindFirst.mockResolvedValue({ createdAt: dernier })
    etatUpdateMany.mockResolvedValue({ count: 0 })
    etatFindUnique.mockResolvedValue(null)

    expect(await avancerLecture(CONV_ID, CANDIDAT_USER_ID)).toBe(true)

    expect(etatFindUnique).toHaveBeenCalledTimes(1)
    expect(etatFindUnique.mock.calls[0]?.[0]?.where).toEqual({
      conversationId_userId: { conversationId: CONV_ID, userId: CANDIDAT_USER_ID },
    })
    expect(etatCreate).toHaveBeenCalledTimes(1)
    expect(etatCreate.mock.calls[0]?.[0]?.data).toEqual({
      conversationId: CONV_ID,
      userId: CANDIDAT_USER_ID,
      luLe: dernier,
    })
  })

  it('create concurrent → P2002 ciblé → retente l’updateMany CAS (une fois)', async () => {
    messageFindFirst.mockResolvedValue({ createdAt: dernier })
    etatUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    etatFindUnique.mockResolvedValue(null)
    etatCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`conversation_id`,`user_id`)',
        { code: 'P2002', clientVersion: '6.19.3' },
      ),
    )

    expect(await avancerLecture(CONV_ID, CANDIDAT_USER_ID)).toBe(true)

    expect(etatUpdateMany).toHaveBeenCalledTimes(2)
    // La retombée reste un CAS : jamais un upsert aveugle.
    expect(etatUpdateMany.mock.calls[1]?.[0]?.where).toEqual({
      conversationId: CONV_ID,
      userId: CANDIDAT_USER_ID,
      OR: [{ luLe: null }, { luLe: { lt: dernier } }],
    })
  })
})

// ─── poserMasque ────────────────────────────────────────────────────────────

describe('poserMasque', () => {
  it('upsert MA ligne d’état (clé composite) avec un masqueLe = Date, idempotent', async () => {
    await poserMasque(CONV_ID, CANDIDAT_USER_ID)

    expect(etatUpsert).toHaveBeenCalledTimes(1)
    const args = etatUpsert.mock.calls[0]?.[0]
    expect(args?.where).toEqual({
      conversationId_userId: { conversationId: CONV_ID, userId: CANDIDAT_USER_ID },
    })
    // create ET update portent la même horodatage : un second appel ne
    // fait que repousser masqueLe, jamais une deuxième ligne.
    expect(args?.create).toEqual({
      conversationId: CONV_ID,
      userId: CANDIDAT_USER_ID,
      masqueLe: expect.any(Date),
    })
    expect(args?.update).toEqual({ masqueLe: expect.any(Date) })
    expect(args?.create?.masqueLe).toBeInstanceOf(Date)
    expect(args?.update?.masqueLe).toBe(args?.create?.masqueLe)
  })
})
