import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma as NsPrisma } from '@prisma/client'

import { emettreNotification, type EmissionNotification } from './notifications-emission'

// ─── Tests du cœur d'émission (M9, Vague 2) ─────────────────────────────────
// Six critères verrouillés ici :
// 1. IDEMPOTENCE : la clé est `type:refId` SANS temps — un rejeu recalcule
//    la même clé, l'upsert incrémente au lieu de dupliquer (rejeu = 1 ligne) ;
// 2. REGROUPEMENT : la branche `update` incrémente `compteur`, met à jour le
//    titre/contenu (le compteur vit dans les variables fermées) et RÉVEILLE
//    la ligne (isLu/lueLe/archiveeLe remis à zéro) ;
// 3. PRÉFÉRENCES : défaut du catalogue, écart explicite dans les deux sens,
//    kill switch `emailsActives` coupant tout sauf les non-désactivables ;
// 4. JAMAIS BLOQUANT : un échec d'émission rend `null` sans lever ; un
//    échec d'empilement email ne ruine PAS l'in-app ;
// 5. OUTBOX : un email n'est empilé qu'avec la préférence effective vraie,
//    avec la clé `email:type:refId` (un rejeu = un seul email) ;
// 6. ZÉRO ÉCRITURE DE HORS-PRAGMA : seuls `notification` et
//    `emailNotification` (+ 2 lectures de préférence) sont exposés au mock —
//    toute autre requête lèverait une TypeError.
// ---------------------------------------------------------------------------

interface ArgsNotificationUpsert {
  where?: NsPrisma.NotificationWhereUniqueInput
  create?: NsPrisma.NotificationUncheckedCreateInput
  update?: NsPrisma.NotificationUpdateManyMutationInput
}

interface ArgsEmailUpsert {
  where?: NsPrisma.EmailNotificationWhereUniqueInput
  create?: NsPrisma.EmailNotificationUncheckedCreateInput
  update?: NsPrisma.EmailNotificationUpdateManyMutationInput
}

interface ArgsReglageFindUnique {
  where?: { userId: number }
}

interface ArgsPreferenceFindUnique {
  where?: { userId_type: { userId: number; type: string } }
}

const { notificationUpsert, emailUpsert, reglageFindUnique, preferenceFindUnique } =
  vi.hoisted(() => ({
    notificationUpsert: vi.fn<(args: ArgsNotificationUpsert) => Promise<unknown>>(),
    emailUpsert: vi.fn<(args: ArgsEmailUpsert) => Promise<unknown>>(),
    reglageFindUnique: vi.fn<(args: ArgsReglageFindUnique) => Promise<unknown>>(),
    preferenceFindUnique: vi.fn<(args: ArgsPreferenceFindUnique) => Promise<unknown>>(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: { upsert: notificationUpsert },
    emailNotification: { upsert: emailUpsert },
    notificationReglage: { findUnique: reglageFindUnique },
    notificationPreference: { findUnique: preferenceFindUnique },
  },
}))

const EMISSION: EmissionNotification = {
  destinataireId: 7,
  type: 'nouveauMessage',
  refId: 42,
  lien: '/messages/42',
  variables: { type: 'nouveauMessage', acteur: 'Marie Dupont', compteur: 1 },
}

beforeEach(() => {
  notificationUpsert.mockReset()
  emailUpsert.mockReset()
  reglageFindUnique.mockReset()
  preferenceFindUnique.mockReset()
  notificationUpsert.mockResolvedValue({ id: 100 })
  emailUpsert.mockResolvedValue({ id: 200 })
  reglageFindUnique.mockResolvedValue(null)
  preferenceFindUnique.mockResolvedValue(null)
  // spyOn retourne le même espion entre les tests : vider l'historique ici,
  // sinon les échecs tracés des tests précédents fuiraient dans le suivant.
  vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear()
})

// ─── 1) Idempotence : clé déterministe sans temps ───────────────────────────

describe('idempotence (clé = type:refId, aucun temps)', () => {
  it('émet avec la clé déterministe `type:refId` (aucune Date dans la clé)', async () => {
    await emettreNotification(EMISSION)

    expect(notificationUpsert).toHaveBeenCalledTimes(1)
    const where = notificationUpsert.mock.calls[0]?.[0]?.where
    expect(where).toEqual({ cle: 'nouveauMessage:42' })
    // La clé ne change jamais entre deux exécutions : pas de timestamp.
    expect(JSON.stringify(where)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('un REJEU (mêmes arguments) produit la MÊME clé → jamais de doublon', async () => {
    await emettreNotification(EMISSION)
    await emettreNotification(EMISSION)

    const cles = notificationUpsert.mock.calls.map((appel) => appel[0]?.where?.cle)
    expect(new Set(cles).size).toBe(1)
  })

  it('create porte userId/type/titre/contenu/lien + compteur 1 + dernierRefId', async () => {
    await emettreNotification(EMISSION)

    expect(notificationUpsert.mock.calls[0]?.[0]?.create).toEqual({
      userId: 7,
      type: 'nouveauMessage',
      cle: 'nouveauMessage:42',
      titre: 'Nouveau message de Marie Dupont',
      contenu: 'Marie Dupont vous a envoyé un message.',
      lien: '/messages/42',
      compteur: 1,
      dernierRefId: 42,
    })
  })

  it('refId distinct = clé distincte (deux conversations = deux lignes)', async () => {
    await emettreNotification({ ...EMISSION, refId: 43 })
    await emettreNotification({ ...EMISSION, refId: 44 })

    const cles = notificationUpsert.mock.calls.map((appel) => appel[0]?.where?.cle)
    expect(cles).toEqual(['nouveauMessage:43', 'nouveauMessage:44'])
  })
})

// ─── 2) Regroupement : la branche update ────────────────────────────────────

describe('regroupement (branche update : compteur + réveil)', () => {
  it('incrémente le compteur, réactualise le texte et RÉVEILLE la ligne', async () => {
    await emettreNotification({
      ...EMISSION,
      variables: { type: 'nouveauMessage', acteur: 'Marie Dupont', compteur: 3 },
    })

    expect(notificationUpsert.mock.calls[0]?.[0]?.update).toEqual({
      compteur: { increment: 1 },
      dernierRefId: 42,
      titre: 'Nouveau message de Marie Dupont',
      contenu: 'Marie Dupont vous a envoyé un message.',
      lien: '/messages/42',
      isLu: false,
      lueLe: null,
      archiveeLe: null,
    })
  })
})

// ─── 3) Préférences et kill switch ──────────────────────────────────────────

describe('préférences email (défaut + écart + kill switch)', () => {
  it('défaut vrai + aucun écart → email empilé enAttente avec clé email:type:refId', async () => {
    // nouveauMessage : emailParDefaut = true, aucune ligne → empilé.
    await emettreNotification(EMISSION)

    expect(emailUpsert).toHaveBeenCalledTimes(1)
    expect(emailUpsert.mock.calls[0]?.[0]?.where).toEqual({
      cle: 'email:nouveauMessage:42',
    })
    expect(emailUpsert.mock.calls[0]?.[0]?.create).toMatchObject({
      destinataireId: 7,
      notificationId: 100,
      type: 'nouveauMessage',
      statut: 'enAttente',
      tentatives: 0,
    })
  })

  it('écart FALSE sur défaut vrai → aucun email (in-app conservé)', async () => {
    preferenceFindUnique.mockResolvedValue({ emailActive: false })

    await emettreNotification(EMISSION)

    expect(notificationUpsert).toHaveBeenCalledTimes(1)
    expect(emailUpsert).not.toHaveBeenCalled()
  })

  it('écart TRUE sur défaut faux (offrePubliee) → email empilé', async () => {
    preferenceFindUnique.mockResolvedValue({ emailActive: true })

    await emettreNotification({
      ...EMISSION,
      type: 'offrePubliee',
      refId: 9,
      lien: '/offres/une-offre',
      variables: { type: 'offrePubliee', titreOffre: 'Une offre' },
    })

    expect(emailUpsert).toHaveBeenCalledTimes(1)
    expect(emailUpsert.mock.calls[0]?.[0]?.where).toEqual({
      cle: 'email:offrePubliee:9',
    })
  })

  it('kill switch ON (emailsActives false) coupe un type désactivable', async () => {
    reglageFindUnique.mockResolvedValue({ emailsActives: false })

    await emettreNotification(EMISSION)

    expect(notificationUpsert).toHaveBeenCalledTimes(1)
    expect(emailUpsert).not.toHaveBeenCalled()
  })

  it('kill switch ne coupe PAS signalementRecu (non désactivable, modération)', async () => {
    reglageFindUnique.mockResolvedValue({ emailsActives: false })

    await emettreNotification({
      ...EMISSION,
      type: 'signalementRecu',
      refId: 5,
      lien: '/admin/signalements',
      variables: { type: 'signalementRecu' },
    })

    expect(emailUpsert).toHaveBeenCalledTimes(1)
  })

  it('rejeu d’événement : l’email empilé n’est JAMAIS réinitialisé (update {})', async () => {
    await emettreNotification(EMISSION)
    await emettreNotification(EMISSION)

    // Deux upserts sur la même clé — le second avec update vide : ni statut
    // ni tentatives ne sont remis à zéro.
    expect(emailUpsert.mock.calls[1]?.[0]?.update).toEqual({})
    const cles = emailUpsert.mock.calls.map((appel) => appel[0]?.where?.cle)
    expect(new Set(cles).size).toBe(1)
  })
})

// ─── 4) Jamais bloquant ─────────────────────────────────────────────────────

describe('échecs avalés (contrat no-throw)', () => {
  it('échec d’upsert notification → null, aucun email tenté, console.error tracée', async () => {
    notificationUpsert.mockRejectedValue(new Error('réseau'))

    await expect(emettreNotification(EMISSION)).resolves.toBeNull()
    expect(emailUpsert).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('échec d’empilement email → l’in-app RÉUSSIT quand même', async () => {
    emailUpsert.mockRejectedValue(new Error('contrainte'))

    await expect(emettreNotification(EMISSION)).resolves.toEqual({ notificationId: 100 })
    expect(notificationUpsert).toHaveBeenCalledTimes(1)
  })

  it('échec de lecture des préférences → avalé, email non empilé, in-app intacte', async () => {
    preferenceFindUnique.mockRejectedValue(new Error('réseau'))

    await expect(emettreNotification(EMISSION)).resolves.toEqual({ notificationId: 100 })
  })

  it('aucun trace en production (console.error silencieux)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    notificationUpsert.mockRejectedValue(new Error('réseau'))

    await emettreNotification(EMISSION)

    expect(console.error).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
