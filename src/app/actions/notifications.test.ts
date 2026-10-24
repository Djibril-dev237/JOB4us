import type { Prisma as NsPrisma } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifySession } from '@/lib/dal'
import { PAGE_NOTIFICATIONS } from '@/lib/notifications-dal'
import { preferencesParDefaut, type TypeNotification } from '@/lib/notifications-labels'
import { prisma } from '@/lib/prisma'
import { notFound, redirect } from 'next/navigation'

import {
  basculerPreferenceEmail,
  chargerNotifications,
  enregistrerResumeQuotidien,
  marquerNotificationLu,
  supprimerNotification,
  toutMarquerLu,
} from './notifications'

// ─── Tests des actions serveur NOTIFICATIONS (M9, Vague 2) ───────────────────
// Critères verrouillés ici (calque de candidatures.test.ts / messagerie.test.ts) :
// 1. FORME D'ABORD : un payload hostile (clé inconnue `userId`,
//    `destinataireId`, type hors catalogue, booléen en chaîne) meurt dans le
//    `.strict()` des schémas RÉELS (jamais mockés) → verdict net et ZÉRO accès
//    à la base.
// 2. 404 INDISCERNABLE : notification d'autrui ≡ inexistante ≡ déjà lue =
//    `notFound()` (les mocks de next/navigation LÈVENT, le flux s'arrête comme
//    en prod), JAMAIS de redirect ni de verdict différencié. L'écriture ne
//    porte QUE `session.userId` — aucune lecture-then-check n'existe (le DAL
//    n'expose d'ailleurs pas de `findFirst`/`findUnique` : la moindre lecture
//    d'appartenance lèverait une TypeError).
// 3. SESSION TOUJOURS DU CONTEXTE : `userId` sort de `verifySession`, jamais du
//    payload (les schémas ne comportent aucun identifiant d'utilisateur).
// 4. PRÉFÉRENCES : ligne absente = défaut du catalogue, ligne présente = valeur
//    stockée — la cible soumise est l'INVERSE de l'état affiché, et l'action
//    l'écrit par un SEUL upsert (aucune seconde lecture).
//
// Patron : `vi.mock('@/lib/prisma')` n'exposant QUE les méthodes utilisées
// (toute requête imprévue casse le test par TypeError), `vi.mock('@/lib/dal')`,
// `next/navigation` qui lève — le DAL notifications et les schémas Zod tournent
// POUR DE VRAI au dessus du prisma simulé. Aucune assertion sur un texte
// d'écran : les textes vivent dans TEXTES.
// ---------------------------------------------------------------------------

// ─── Args des doubles (zéro `any` : lecture des arguments réels) ────────────

interface ArgsNotificationFindMany {
  where?: NsPrisma.NotificationWhereInput
  orderBy?: NsPrisma.NotificationOrderByWithRelationInput | NsPrisma.NotificationOrderByWithRelationInput[]
  select?: NsPrisma.NotificationSelect
  take?: number
}

interface ArgsNotificationUpdateMany {
  where?: NsPrisma.NotificationWhereInput
  data?: NsPrisma.NotificationUpdateManyMutationInput
}

interface ArgsNotificationDeleteMany {
  where?: NsPrisma.NotificationWhereInput
}

interface ArgsPreferenceUpsert {
  where: { userId_type: { userId: number; type: TypeNotification } }
  create: { userId: number; type: TypeNotification; emailActive: boolean }
  update: { emailActive: boolean }
}

interface ArgsReglageUpsert {
  where: { userId: number }
  create: { userId: number; resumeQuotidien: boolean }
  update: { resumeQuotidien: boolean }
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

const {
  notificationFindMany,
  notificationUpdateMany,
  notificationDeleteMany,
  notificationPreferenceUpsert,
  notificationReglageUpsert,
} = vi.hoisted(() => ({
  notificationFindMany: vi.fn<(args: ArgsNotificationFindMany) => Promise<unknown>>(),
  notificationUpdateMany: vi.fn<(args: ArgsNotificationUpdateMany) => Promise<{ count: number }>>(),
  notificationDeleteMany: vi.fn<(args: ArgsNotificationDeleteMany) => Promise<{ count: number }>>(),
  notificationPreferenceUpsert: vi.fn<(args: ArgsPreferenceUpsert) => Promise<unknown>>(),
  notificationReglageUpsert: vi.fn<(args: ArgsReglageUpsert) => Promise<unknown>>(),
}))

// Seules les méthodes utilisées par le DAL et par les actions sont exposées :
// un `findFirst` d'appartenance, un `findUnique` de préférence ou tout autre
// accès imprévu lèverait une TypeError — c'est la preuve mécanique qu'aucune
// lecture de vérification ni aucun modèle supplémentaire n'entre en jeu.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: notificationFindMany,
      updateMany: notificationUpdateMany,
      deleteMany: notificationDeleteMany,
    },
    notificationPreference: { upsert: notificationPreferenceUpsert },
    notificationReglage: { upsert: notificationReglageUpsert },
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

// redirect() et notFound() lèvent en production : les mocks font pareil, sinon
// l'action continuerait après son 404 et les assertions « aucune écriture après
// refus » seraient fausses.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 11
const AUTRE_USER_ID = 22
const NOTIF_ID = 501
const DATE_NOTIF = new Date('2026-10-16T09:00:00.000Z')
const ISO_NOTIF = '2026-10-16T09:00:00.000Z'

/** Notification « standard » (payload simulé du findMany du DAL). */
function notifSim(overrides?: Partial<NotificationSim>): NotificationSim {
  return {
    id: NOTIF_ID,
    type: 'nouveauMessage',
    titre: 'Nouveau message de Awa',
    contenu: 'Awa vous a envoyé un message.',
    lien: '/messages/9',
    isLu: false,
    compteur: 1,
    createdAt: DATE_NOTIF,
    ...overrides,
  }
}

/** Premier `where` passé à `prisma.notification.updateMany`. */
function whereUpdateMany(): Record<string, unknown> | undefined {
  return (notificationUpdateMany.mock.calls[0]?.[0] as
    | { where: Record<string, unknown> }
    | undefined)?.where
}

/** Premier `data` passé à `prisma.notification.updateMany`. */
function dataUpdateMany(): Record<string, unknown> | undefined {
  return (notificationUpdateMany.mock.calls[0]?.[0] as
    | { data: Record<string, unknown> }
    | undefined)?.data
}

/**
 * Cible d'un interrupteur : l'INVERSE de l'état EFFECTIF affiché — ligne en
 * base si elle existe, sinon défaut du catalogue (règle de la page, source
 * `preferencesParDefaut()`). L'action reçoit cette cible et l'écrit telle
 * quelle (le schema porte `emailActive`).
 */
function cibleDeBascule(
  ligne: { emailActive: boolean } | null,
  type: TypeNotification,
): boolean {
  const affiche = ligne === null ? preferencesParDefaut()[type] : ligne.emailActive
  return !affiche
}

/** Ligne étrangère / inexistante : 404, et JAMAIS de redirection. */
async function attend404(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toThrow('NOT_FOUND')
  expect(notFound).toHaveBeenCalledTimes(1)
  expect(redirect).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
  notificationFindMany.mockResolvedValue([])
  notificationUpdateMany.mockResolvedValue({ count: 1 })
  notificationDeleteMany.mockResolvedValue({ count: 1 })
  notificationPreferenceUpsert.mockResolvedValue(undefined)
  notificationReglageUpsert.mockResolvedValue(undefined)
})

// ─── chargerNotifications ────────────────────────────────────────────────────

describe('chargerNotifications', () => {
  it('premier chargement (objet vide) : curseur null transmis, userId de la SESSION, 1 requête', async () => {
    notificationFindMany.mockResolvedValue([notifSim()])

    const page = await chargerNotifications({})

    expect(page).toEqual({
      notifications: [expect.objectContaining({ id: NOTIF_ID, createdAt: DATE_NOTIF })],
      aPlusAncien: false,
    })
    expect(notificationFindMany).toHaveBeenCalledTimes(1)
    expect(notificationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      userId: USER_ID,
      archiveeLe: null,
    })
    expect(notificationFindMany.mock.calls[0]?.[0]?.take).toBe(PAGE_NOTIFICATIONS + 1)
  })

  it('curseur reçu : tuple ISO + id décodé vers le where OR du DAL, userId toujours celui de la session', async () => {
    await chargerNotifications({ curseur: [ISO_NOTIF, NOTIF_ID] })

    expect(notificationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      userId: USER_ID,
      archiveeLe: null,
      OR: [
        { createdAt: { lt: new Date(ISO_NOTIF) } },
        { createdAt: new Date(ISO_NOTIF), id: { lt: NOTIF_ID } },
      ],
    })
  })

  it("payload hostile (`userId` d'autrui injecté) : .strict() refuse, AUCUNE requête", async () => {
    const page = await chargerNotifications({
      curseur: [ISO_NOTIF, NOTIF_ID],
      userId: AUTRE_USER_ID,
    })

    expect(page).toBeNull()
    expect(notificationFindMany).not.toHaveBeenCalled()
  })

  it('payload hors contrat (notificationId) : null, aucune requête', async () => {
    await expect(chargerNotifications({ notificationId: NOTIF_ID })).resolves.toBeNull()

    expect(notificationFindMany).not.toHaveBeenCalled()
  })

  it('erreur DB : null — aucune exception brute ne sort de l’action', async () => {
    notificationFindMany.mockRejectedValue(new Error('DB_DOWN'))

    await expect(chargerNotifications({})).resolves.toBeNull()
  })
})

// ─── marquerNotificationLu ───────────────────────────────────────────────────

describe('marquerNotificationLu', () => {
  it('nominal : updateMany porte id + userId SESSION → { ok: true }', async () => {
    const resultat = await marquerNotificationLu({ notificationId: NOTIF_ID })

    expect(resultat).toEqual({ ok: true })
    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    expect(whereUpdateMany()).toEqual({
      id: NOTIF_ID,
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    expect(dataUpdateMany()).toEqual({ isLu: true, lueLe: expect.any(Date) })
  })

  it('payload hostile (clé `userId` injectée) : refus net, ZÉRO écriture', async () => {
    const resultat = await marquerNotificationLu({
      notificationId: NOTIF_ID,
      userId: AUTRE_USER_ID,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationUpdateMany).not.toHaveBeenCalled()
    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("notification d'autrui (count 0) : notFound(), l'écriture ne porte QUE la session, AUCUNE lecture de vérification", async () => {
    notificationUpdateMany.mockResolvedValue({ count: 0 })

    await attend404(marquerNotificationLu({ notificationId: NOTIF_ID }))

    // Une SEULE écriture conditionnelle, dont le where porte la session —
    // jamais l'id reçu comme userId, jamais de lecture puis contre-vérification
    // (un `findFirst` d'appartenance n'est même pas exposé par le prisma mocké).
    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    expect(whereUpdateMany()).toEqual({
      id: NOTIF_ID,
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(notificationDeleteMany).not.toHaveBeenCalled()
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
    expect(notificationReglageUpsert).not.toHaveBeenCalled()
  })

  it('erreur DB : { ok: false }, log de pointeur + code SANS donnée personnelle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notificationUpdateMany.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('write timeout', {
        code: 'P2002',
        clientVersion: '6.19.3',
      })
    })

    const resultat = await marquerNotificationLu({ notificationId: NOTIF_ID })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notFound).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[notifications] marquer-lu', {
      notificationId: NOTIF_ID,
      code: 'P2002',
    })
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })
})

// ─── toutMarquerLu ───────────────────────────────────────────────────────────

describe('toutMarquerLu', () => {
  it('nominal : retourne le nombre, le where cible TOUTES les non-lues de la SESSION', async () => {
    notificationUpdateMany.mockResolvedValue({ count: 3 })

    await expect(toutMarquerLu()).resolves.toBe(3)

    expect(notificationUpdateMany).toHaveBeenCalledTimes(1)
    // Ni id de notification, ni userId venu d'ailleurs : la session EST la cible.
    expect(whereUpdateMany()).toEqual({
      userId: USER_ID,
      isLu: false,
      archiveeLe: null,
    })
    expect(dataUpdateMany()).toEqual({ isLu: true, lueLe: expect.any(Date) })
  })

  it('erreur DB : null (verdict net, aucune exception brute)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notificationUpdateMany.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    await expect(toutMarquerLu()).resolves.toBeNull()
    expect(consoleError).toHaveBeenCalledWith('[notifications] tout-lu', {
      userId: USER_ID,
      code: 'INCONNU',
    })

    consoleError.mockRestore()
  })
})

// ─── supprimerNotification ───────────────────────────────────────────────────

describe('supprimerNotification', () => {
  it('nominal : deleteMany porte id + userId SESSION → { ok: true }', async () => {
    const resultat = await supprimerNotification({ notificationId: NOTIF_ID })

    expect(resultat).toEqual({ ok: true })
    expect(notificationDeleteMany).toHaveBeenCalledTimes(1)
    expect(notificationDeleteMany.mock.calls[0]?.[0]?.where).toEqual({
      id: NOTIF_ID,
      userId: USER_ID,
    })
    expect(notificationUpdateMany).not.toHaveBeenCalled()
  })

  it("payload hostile (clé `userId` d'autrui) : refus net, ZÉRO suppression", async () => {
    const resultat = await supprimerNotification({
      notificationId: NOTIF_ID,
      userId: AUTRE_USER_ID,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationDeleteMany).not.toHaveBeenCalled()
    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("notification d'autrui (count 0) : notFound(), la suppression ne porte QUE la session, sans lecture préalable", async () => {
    notificationDeleteMany.mockResolvedValue({ count: 0 })

    await attend404(supprimerNotification({ notificationId: NOTIF_ID }))

    expect(notificationDeleteMany).toHaveBeenCalledTimes(1)
    expect(notificationDeleteMany.mock.calls[0]?.[0]?.where).toEqual({
      id: NOTIF_ID,
      userId: USER_ID,
    })
    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(notificationUpdateMany).not.toHaveBeenCalled()
  })

  it('erreur DB : { ok: false } + log sans donnée personnelle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notificationDeleteMany.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await supprimerNotification({ notificationId: NOTIF_ID })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[notifications] supprimer', {
      notificationId: NOTIF_ID,
      code: 'INCONNU',
    })
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })
})

// ─── basculerPreferenceEmail ─────────────────────────────────────────────────

describe('basculerPreferenceEmail', () => {
  it('ligne ABSENTE (défaut false) : écrit l’inverse du défaut, par un SEUL upsert sans lecture', async () => {
    const type: TypeNotification = 'offrePubliee'
    expect(preferencesParDefaut()[type]).toBe(false)
    const cible = cibleDeBascule(null, type)
    expect(cible).toBe(true)

    const resultat = await basculerPreferenceEmail({ type, emailActive: cible })

    expect(resultat).toEqual({ ok: true })
    expect(notificationPreferenceUpsert).toHaveBeenCalledTimes(1)
    expect(notificationPreferenceUpsert.mock.calls[0]?.[0]).toEqual({
      where: { userId_type: { userId: USER_ID, type } },
      create: { userId: USER_ID, type, emailActive: cible },
      update: { emailActive: cible },
    })
    // Preuve mécanique « aucune lecture » : le double du modèle n'expose que
    // l'upsert — un `findUnique` d'état leverait une TypeError (et ferait
    // échouer ce test, qui attend `ok: true`).
    expect(Object.keys(prisma.notificationPreference)).toEqual(['upsert'])
  })

  it('ligne ABSENTE (défaut true) : écrit l’inverse du défaut, donc false', async () => {
    const type: TypeNotification = 'nouveauMessage'
    expect(preferencesParDefaut()[type]).toBe(true)
    const cible = cibleDeBascule(null, type)
    expect(cible).toBe(false)

    const resultat = await basculerPreferenceEmail({ type, emailActive: cible })

    expect(resultat).toEqual({ ok: true })
    expect(notificationPreferenceUpsert.mock.calls[0]?.[0]).toEqual({
      where: { userId_type: { userId: USER_ID, type } },
      create: { userId: USER_ID, type, emailActive: false },
      update: { emailActive: false },
    })
  })

  it('ligne PRÉSENTE : la cible est l’inverse de la ligne stockée (état affiché = ligne, pas le défaut)', async () => {
    const type: TypeNotification = 'offrePubliee'
    // Ligne active alors que le défaut du catalogue est false : l'affiché
    // EST la ligne, la bascule part donc vers false.
    const ligne = { emailActive: true }
    const cible = cibleDeBascule(ligne, type)
    expect(cible).toBe(false)

    const resultat = await basculerPreferenceEmail({ type, emailActive: cible })

    expect(resultat).toEqual({ ok: true })
    expect(notificationPreferenceUpsert).toHaveBeenCalledTimes(1)
    expect(notificationPreferenceUpsert.mock.calls[0]?.[0]?.where).toEqual({
      userId_type: { userId: USER_ID, type },
    })
    expect(notificationPreferenceUpsert.mock.calls[0]?.[0]?.update).toEqual({ emailActive: false })
    expect(notificationPreferenceUpsert.mock.calls[0]?.[0]?.create).toEqual({
      userId: USER_ID,
      type,
      emailActive: false,
    })
  })

  it('type NON désactivable (signalementRecu) : refus métier, AUCUNE écriture', async () => {
    const resultat = await basculerPreferenceEmail({
      type: 'signalementRecu',
      emailActive: cibleDeBascule(null, 'signalementRecu'),
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
    expect(notificationReglageUpsert).not.toHaveBeenCalled()
  })

  it('payload hostile (clé `userId` injectée) : refus, AUCUNE écriture', async () => {
    const resultat = await basculerPreferenceEmail({
      type: 'nouveauMessage',
      emailActive: false,
      userId: AUTRE_USER_ID,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
  })

  it('type hors catalogue : refus par z.enum, AUCUNE écriture', async () => {
    const resultat = await basculerPreferenceEmail({
      type: 'Systeme',
      emailActive: true,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
  })

  it('emailActive en chaîne (« true ») : refus par z.boolean strict, AUCUNE écriture', async () => {
    const resultat = await basculerPreferenceEmail({
      type: 'nouveauMessage',
      emailActive: 'true',
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
  })

  it('erreur DB : { ok: false } + log sans donnée personnelle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notificationPreferenceUpsert.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await basculerPreferenceEmail({
      type: 'offrePubliee',
      emailActive: true,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[notifications] preference-email', {
      type: 'offrePubliee',
      code: 'INCONNU',
    })

    consoleError.mockRestore()
  })
})

// ─── enregistrerResumeQuotidien ──────────────────────────────────────────────

describe('enregistrerResumeQuotidien', () => {
  it('nominal : upsert sur la clé de session avec la valeur booléenne reçue', async () => {
    const resultat = await enregistrerResumeQuotidien({ resumeQuotidien: true })

    expect(resultat).toEqual({ ok: true })
    expect(notificationReglageUpsert).toHaveBeenCalledTimes(1)
    expect(notificationReglageUpsert.mock.calls[0]?.[0]).toEqual({
      where: { userId: USER_ID },
      create: { userId: USER_ID, resumeQuotidien: true },
      update: { resumeQuotidien: true },
    })
    // Le réglage d'un type n'écrit JAMAIS la table des préférences.
    expect(notificationPreferenceUpsert).not.toHaveBeenCalled()
  })

  it('payload hostile (clé `userId` injectée) : refus, AUCUNE écriture', async () => {
    const resultat = await enregistrerResumeQuotidien({
      resumeQuotidien: false,
      userId: AUTRE_USER_ID,
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationReglageUpsert).not.toHaveBeenCalled()
  })

  it('valeur en chaîne (« true ») : refus par z.boolean strict, AUCUNE écriture', async () => {
    const resultat = await enregistrerResumeQuotidien({ resumeQuotidien: 'true' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(notificationReglageUpsert).not.toHaveBeenCalled()
  })

  it('erreur DB : { ok: false } + log sans donnée personnelle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    notificationReglageUpsert.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await enregistrerResumeQuotidien({ resumeQuotidien: true })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[notifications] resume-quotidien', {
      code: 'INCONNU',
    })
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain(String(USER_ID))

    consoleError.mockRestore()
  })
})

// ─── Périmètre de session (tous les rôles authentifiés) ──────────────────────

describe('session', () => {
  it("admin authentifié : les actions passent (la cloche n'est pas réservée à candidat/recruteur)", async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'admin' })

    await expect(marquerNotificationLu({ notificationId: NOTIF_ID })).resolves.toEqual({
      ok: true,
    })
    await expect(enregistrerResumeQuotidien({ resumeQuotidien: true })).resolves.toEqual({
      ok: true,
    })
    expect(whereUpdateMany()).toEqual(
      expect.objectContaining({ userId: USER_ID }),
    )
  })

  it('la session est acquise AVANT toute requête : un payload invalide n’atteint même pas la base si la session échoue', async () => {
    vi.mocked(verifySession).mockImplementation(async () => {
      throw new Error('REDIRECT:/login')
    })

    await expect(marquerNotificationLu({ notificationId: NOTIF_ID })).rejects.toThrow(
      'REDIRECT:/login',
    )
    expect(notificationUpdateMany).not.toHaveBeenCalled()
    expect(notificationFindMany).not.toHaveBeenCalled()
  })
})
