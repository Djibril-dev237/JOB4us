import type { Prisma as NsPrisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TypeNotification } from '@/lib/notifications-labels'

import {
  DELAI_ARCHIVAGE_JOURS,
  DELAI_PURGE_JOURS,
  PAGE_NOTIFICATIONS,
  archiverLuees,
  compterNonLues,
  curseurDepuisPayload,
  listerNotifications,
  marquerLue,
  marquerToutLue,
  purgerArchivees,
  supprimerNotification,
} from './notifications-dal'

// ─── Tests de la couche de données NOTIFICATIONS (M9, Vague 1) ──────────────
// Quatre critères verrouillés ici :
// 1. toute opération ciblée par id porte l'AUTORISATION dans le `where` de
//    l'écriture/lecture elle-même (MÊME requête Prisma) — un id d'autrui
//    rend count 0 / false, INDISCERNABLE d'un id inexistant (404 global,
//    aucun oracle d'énumération, jamais de 403) ;
// 2. `listerNotifications` pagine par curseur COMPOSITE [createdAt, id]
//    STRICT (`lt`, jamais `lte`) et émet UNE requête fixe — le `take` de
//    PAGE_NOTIFICATIONS + 1 prouve la page suivante puis tronque ;
// 3. `marquerLue` ne régresse JAMAIS `lueLe` : le CAS `isLu: false` vit
//    dans le `where` du updateMany ;
// 4. les deux crons n'emportent AUCUN userId (globaux) — leur where porte
//    les seuils 30 j / 90 j seuls.
//
// Patron repris de messagerie-dal.test.ts : vi.hoisted + vi.mock('@/lib/prisma')
// n'exposant QUE les méthodes testées — toute requête supplémentaire du DAL
// lèverait une TypeError et casserait le test (c'est ainsi qu'on prouve le
// comptage fixe des requêtes).
// ---------------------------------------------------------------------------

// ─── Args des doubles (zéro `any` : lecture des arguments réels) ────────────

interface ArgsNotificationFindMany {
  where?: NsPrisma.NotificationWhereInput
  orderBy?: NsPrisma.NotificationOrderByWithRelationInput | NsPrisma.NotificationOrderByWithRelationInput[]
  select?: NsPrisma.NotificationSelect
  take?: number
}

interface ArgsNotificationCount {
  where?: NsPrisma.NotificationWhereInput
}

interface ArgsNotificationUpdateMany {
  where?: NsPrisma.NotificationWhereInput
  data?: NsPrisma.NotificationUpdateManyMutationInput
}

interface ArgsNotificationDeleteMany {
  where?: NsPrisma.NotificationWhereInput
}

// Ligne simulée (payload retourné par le mock, jamais `any`).

interface NotificationSim {
  id: number
  type: TypeNotification
  titre: string
  contenu: string | null
  lien: string | null
  isLu: boolean
  compteur: number
  createdAt: Date
}

const { notificationFindMany, notificationCount, notificationUpdateMany, notificationDeleteMany } =
  vi.hoisted(() => ({
    notificationFindMany: vi.fn<(args: ArgsNotificationFindMany) => Promise<unknown>>(),
    notificationCount: vi.fn<(args: ArgsNotificationCount) => Promise<number>>(),
    notificationUpdateMany: vi.fn<(args: ArgsNotificationUpdateMany) => Promise<{ count: number }>>(),
    notificationDeleteMany: vi.fn<(args: ArgsNotificationDeleteMany) => Promise<{ count: number }>>(),
  }))

// Seules les méthodes du DAL sont exposées : une requête de plus (un
// findUnique, un include relationnel…) casserait le test par TypeError —
// c'est la preuve mécanique du comptage fixe des requêtes.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: notificationFindMany,
      count: notificationCount,
      updateMany: notificationUpdateMany,
      deleteMany: notificationDeleteMany,
    },
  },
}))

// ─── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID = 11
const AUTRE_USER_ID = 22
const NOTIF_ID = 501

/** Notification « standard » (payload simulé du findMany). */
function notifSim(overrides?: Partial<NotificationSim>): NotificationSim {
  return {
    id: NOTIF_ID,
    type: 'nouveauMessage',
    titre: 'Nouveau message de Awa',
    contenu: 'Awa vous a envoyé un message.',
    lien: '/messages/9',
    isLu: false,
    compteur: 1,
    createdAt: new Date('2026-10-16T09:00:00Z'),
    ...overrides,
  }
}

/** Bruts « plus récents d'abord » (id et createdAt décroissants), calque Prisma. */
function brutsDecroissants(nombre: number, idDepart: number, baseMs: number): NotificationSim[] {
  return Array.from({ length: nombre }, (_, index) =>
    notifSim({ id: idDepart - index, createdAt: new Date(baseMs - index * 1_000) }),
  )
}

beforeEach(() => {
  notificationFindMany.mockReset()
  notificationCount.mockReset()
  notificationUpdateMany.mockReset()
  notificationDeleteMany.mockReset()
  notificationFindMany.mockResolvedValue([])
  notificationCount.mockResolvedValue(0)
  notificationUpdateMany.mockResolvedValue({ count: 0 })
  notificationDeleteMany.mockResolvedValue({ count: 0 })
})

afterEach(() => {
  // Les crons sont testés sous horloge simulée : toujours restaurer.
  vi.useRealTimers()
})

// ─── Constantes exportées (pagination testable) ─────────────────────────────

describe('constantes (contrat figé des vagues suivantes)', () => {
  it('PAGE_NOTIFICATIONS = 20, archivage à 30 j, purge à 90 j', () => {
    expect(PAGE_NOTIFICATIONS).toBe(20)
    expect(DELAI_ARCHIVAGE_JOURS).toBe(30)
    expect(DELAI_PURGE_JOURS).toBe(90)
  })
})

// ─── curseurDepuisPayload (pont Zod → DAL) ──────────────────────────────────

describe('curseurDepuisPayload (pont payload validé → forme du DAL)', () => {
  it('curseur absent → null (premier chargement), aucun appel base', () => {
    expect(curseurDepuisPayload({})).toBeNull()
    expect(notificationFindMany).not.toHaveBeenCalled()
  })

  it('tuple ISO offset + id → { createdAt: Date, id } (la Date garde l’instant exact)', () => {
    expect(curseurDepuisPayload({ curseur: ['2026-10-15T08:00:00+02:00', 42] })).toEqual({
      createdAt: new Date('2026-10-15T08:00:00+02:00'),
      id: 42,
    })
  })

  it('résultat directement consommable par listerNotifications (même curseur, même where)', async () => {
    const curseur = curseurDepuisPayload({ curseur: ['2026-10-15T08:00:00Z', 42] })

    await listerNotifications(USER_ID, curseur)

    const where = notificationFindMany.mock.calls[0]?.[0]?.where
    expect(where?.OR).toEqual([
      { createdAt: { lt: new Date('2026-10-15T08:00:00Z') } },
      { createdAt: new Date('2026-10-15T08:00:00Z'), id: { lt: 42 } },
    ])
  })
})

// ─── listerNotifications ────────────────────────────────────────────────────

describe('listerNotifications (curseur composite strict, 1 requête fixe)', () => {
  it('sans curseur : userId + archivées exclues, tri DESC composite, take PAGE+1, zéro relation user', async () => {
    expect(await listerNotifications(USER_ID, null)).toEqual({ notifications: [], aPlusAncien: false })

    expect(notificationFindMany).toHaveBeenCalledTimes(1)
    const args = notificationFindMany.mock.calls[0]?.[0]
    // L'exclusion des archivées vit dans le `where` SQL (pas filtré après
    // coup — aucune requête de plus, aucun transfert inutile).
    expect(args?.where).toEqual({ userId: USER_ID, archiveeLe: null })
    // Tri composite aligné sur le curseur [createdAt, id], DESC.
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    expect(args?.take).toBe(PAGE_NOTIFICATIONS + 1)
    // Projection minimale : la relation user n'est PAS chargée.
    expect(args?.select).toEqual({
      id: true,
      type: true,
      titre: true,
      contenu: true,
      lien: true,
      isLu: true,
      compteur: true,
      createdAt: true,
    })
    expect(args?.select).not.toHaveProperty('user')
  })

  it('curseur fourni : clause composite STRICTE — `lt` partout, jamais `lte`', async () => {
    const curseur = { createdAt: new Date('2026-10-15T08:00:00Z'), id: 42 }

    await listerNotifications(USER_ID, curseur)

    const where = notificationFindMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual({
      userId: USER_ID,
      archiveeLe: null,
      OR: [{ createdAt: { lt: curseur.createdAt } }, { createdAt: curseur.createdAt, id: { lt: curseur.id } }],
    })
    // `lte` dupliquerait le message-curser en tête de la page suivante.
    expect(JSON.stringify(where)).not.toContain('lte')
  })

  it('21 bruts → 20 rendus dans l’ordre reçu + aPlusAncien true (la 21e prouve la page suivante)', async () => {
    const baseMs = Date.UTC(2026, 9, 16, 12, 0, 0)
    notificationFindMany.mockResolvedValue(brutsDecroissants(PAGE_NOTIFICATIONS + 1, 121, baseMs))

    const page = await listerNotifications(USER_ID, null)

    expect(page.aPlusAncien).toBe(true)
    expect(page.notifications).toHaveLength(PAGE_NOTIFICATIONS)
    // Troncature des plus RÉCENTS d'abord (ids 121 → 102), le 21e (id 101)
    // éjecté car il n'existait que pour prouver la page suivante.
    expect(page.notifications.map((ligne) => ligne.id)).toEqual(
      Array.from({ length: PAGE_NOTIFICATIONS }, (_, index) => 121 - index),
    )
  })

  it('dernière page (moins d’une page) : aPlusAncien false, champs projetés tels quels', async () => {
    const baseMs = Date.UTC(2026, 9, 16, 12, 0, 0)
    notificationFindMany.mockResolvedValue(brutsDecroissants(3, 50, baseMs))

    const page = await listerNotifications(USER_ID, null)

    expect(page.aPlusAncien).toBe(false)
    expect(page.notifications.map((ligne) => ligne.id)).toEqual([50, 49, 48])
    // La projection est rendue champ pour champ (aucun champ du modèle
    // hors contrat ne fuit dans la ligne).
    expect(page.notifications[0]).toEqual({
      id: 50,
      type: 'nouveauMessage',
      titre: 'Nouveau message de Awa',
      contenu: 'Awa vous a envoyé un message.',
      lien: '/messages/9',
      isLu: false,
      compteur: 1,
      createdAt: new Date(baseMs),
    })
  })
})

// ─── compterNonLues ─────────────────────────────────────────────────────────

describe('compterNonLues (compteur de la cloche M2)', () => {
  it('where exact { userId, isLu: false, archiveeLe: null } et retour du count, 1 seule requête', async () => {
    notificationCount.mockResolvedValue(7)

    expect(await compterNonLues(USER_ID)).toBe(7)

    expect(notificationCount).toHaveBeenCalledTimes(1)
    expect(notificationCount.mock.calls[0]?.[0]?.where).toEqual({
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    // Le compteur ne compte QUE le mien : aucune écriture possible ici.
    expect(notificationUpdateMany).not.toHaveBeenCalled()
    expect(notificationDeleteMany).not.toHaveBeenCalled()
  })
})

// ─── marquerLue ─────────────────────────────────────────────────────────────

describe('marquerLue (autorisation portée par le where de l’écriture)', () => {
  it('where = { id, userId, isLu: false, archiveeLe: null } → count 1 → true (lueLe jamais régressé)', async () => {
    notificationUpdateMany.mockResolvedValue({ count: 1 })

    expect(await marquerLue(NOTIF_ID, USER_ID)).toBe(true)

    // L'AUTORISATION (userId) et le CAS anti-régression (isLu: false) sont
    // dans le where du MÊME updateMany — pas de lecture puis re-vérif.
    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      id: NOTIF_ID,
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    const data = notificationUpdateMany.mock.calls[0]?.[0]?.data
    expect(data).toEqual({ isLu: true, lueLe: expect.any(Date) })
    expect(data?.lueLe).toBeInstanceOf(Date)
    // TOCTOU : AUCUNE lecture préalable — l'autorisation vit dans le where du
    // updateMany, jamais une findMany suivie d'une re-vérification.
    expect(notificationFindMany).not.toHaveBeenCalled()
  })

  it('count 0 → false (déjà lue, archivée ou inexistante : verdict identique, aucune écriture de plus)', async () => {
    notificationUpdateMany.mockResolvedValue({ count: 0 })

    expect(await marquerLue(NOTIF_ID, USER_ID)).toBe(false)

    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('id d’AUTRUI → le where porte le userId de l’appelant → count 0 → false (404 indiscernable)', async () => {
    // La base ne rendrait rien pour une notification qui n'appartient pas à
    // l'appelant : le mock reproduit count 0, et la CLÉ du test est que le
    // userId APPELANT est déjà dans le where envoyé à la base.
    notificationUpdateMany.mockResolvedValue({ count: 0 })

    expect(await marquerLue(NOTIF_ID, AUTRE_USER_ID)).toBe(false)

    expect(notificationUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      id: NOTIF_ID,
      userId: AUTRE_USER_ID,
      isLu: false,
      archiveeLe: null,
    })
  })

  it('déjà lue : le CAS isLu false échoue → false, lueLe d’origine intacte (aucune écriture)', async () => {
    notificationUpdateMany.mockResolvedValue({ count: 0 })

    expect(await marquerLue(NOTIF_ID, USER_ID)).toBe(false)

    // La garde est DANS le where : une notification déjà lue ne peut même
    // pas être ciblée — `lueLe` ne sera jamais réécrit par un second appel.
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.where?.isLu).toBe(false)
  })
})

// ─── marquerToutLue ─────────────────────────────────────────────────────────

describe('marquerToutLue', () => {
  it('where { userId, isLu: false, archiveeLe: null }, compte toujours par userId, retourne le count', async () => {
    notificationUpdateMany.mockResolvedValue({ count: 7 })

    expect(await marquerToutLue(USER_ID)).toBe(7)

    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    // Le userId est à la fois la clause d'autorisation ET de ciblage :
    // jamais un where sans userId qui traverserait les comptes.
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.data).toEqual({
      isLu: true,
      lueLe: expect.any(Date),
    })
  })
})

// ─── supprimerNotification ──────────────────────────────────────────────────

describe('supprimerNotification (autorisation dans le deleteMany)', () => {
  it('where { id, userId } exact → count 1 → true', async () => {
    notificationDeleteMany.mockResolvedValue({ count: 1 })

    expect(await supprimerNotification(NOTIF_ID, USER_ID)).toBe(true)

    expect(notificationDeleteMany).toHaveBeenCalledTimes(1)
    expect(notificationDeleteMany.mock.calls[0]?.[0]?.where).toEqual({ id: NOTIF_ID, userId: USER_ID })
    // Aucune autre écriture : pas de read-then-delete, pas de vérif après coup.
    expect(notificationUpdateMany).not.toHaveBeenCalled()
    // TOCTOU : jamais de findMany préalable pour « voir si elle existe » —
    // la suppression porte l'autorisation dans son propre where.
    expect(notificationFindMany).not.toHaveBeenCalled()
  })

  it('id d’autrui (ou inexistant) → count 0 → false (verdict identique)', async () => {
    notificationDeleteMany.mockResolvedValue({ count: 0 })

    expect(await supprimerNotification(NOTIF_ID, AUTRE_USER_ID)).toBe(false)

    // Mêmes clés de where pour l'étranger : aucun indice différencié.
    expect(notificationDeleteMany.mock.calls[0]?.[0]?.where).toEqual({
      id: NOTIF_ID,
      userId: AUTRE_USER_ID,
    })
  })
})

// ─── archiverLuees / purgerArchivees (crons globaux) ────────────────────────

describe('archiverLuees / purgerArchivees (crons globaux, where de seuil)', () => {
  const MAINTENANT = new Date('2026-10-17T12:00:00Z')
  const SEUIL_30_JOURS = new Date('2026-09-17T12:00:00Z')
  const SEUIL_90_JOURS = new Date('2026-07-19T12:00:00Z')

  it('archiverLuees : where { isLu, archiveeLe null, lueLe < 30 j }, archiveeLe = maintenant, retour du count', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MAINTENANT)
    notificationUpdateMany.mockResolvedValue({ count: 3 })

    expect(await archiverLuees()).toBe(3)

    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    // Aucun userId : la tâche est GLOBALE, le where ne porte que le seuil.
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.where).toEqual({
      isLu: true,
      archiveeLe: null,
      lueLe: { lt: SEUIL_30_JOURS },
    })
    expect(notificationUpdateMany.mock.calls[0]?.[0]?.data).toEqual({ archiveeLe: MAINTENANT })
    // Une notification non lue ou déjà archivée ne peut pas être ciblée.
    expect(notificationDeleteMany).not.toHaveBeenCalled()
  })

  it('purgerArchivees : where { archiveeLe < 90 j } seul, retour du count (aucun userId)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MAINTENANT)
    notificationDeleteMany.mockResolvedValue({ count: 5 })

    expect(await purgerArchivees()).toBe(5)

    expect(notificationDeleteMany).toHaveBeenCalledTimes(1)
    expect(notificationDeleteMany.mock.calls[0]?.[0]?.where).toEqual({
      archiveeLe: { lt: SEUIL_90_JOURS },
    })
    // La purge ne supprime QUE via son seuil : pas d'updateMany de flanc.
    expect(notificationUpdateMany).not.toHaveBeenCalled()
  })
})
