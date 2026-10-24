import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TEXTES } from './notifications-labels'
import {
  MAX_TENTATIVES,
  PLAFOND_HEURE,
  PLAFOND_JOUR,
  preparerResumesQuotidiens,
  traiterFileEmails,
} from './notifications-outbox'

// ─── Contrats de l'outbox emails (M9, Vague 3) ──────────────────────────────
// Verrous :
//  1. CONFIGURATION ABSENTE = NO-OP TOTAL : ni lecture de file, ni écriture ;
//  2. RÉCLAMATION atomique : un cron qui perd le `updateMany` n'envoie rien ;
//  3. envoi réussi → statut `envoye`, date posée, erreur effacée ;
//  4. échec → `tentatives` + échéance de reprise (5 min, 20 min), puis
//     `abandonne` au plafond — aucune boucle infinie, aucun throw ;
//  5. préférences RELUES à l'envoi : désabonnement/type coupé → abandon
//     `desactive` sans envoi ; `signalementRecu` traverse le kill switch ;
//  6. plafonds 6/h et 30/j : report sans consommer de tentative ;
//  7. digest : une ligne par compte et par jour UTC, seulement s'il existe des
//     notifications éligibles ; lignes filtrées par type et par les emails
//     déjà empilés individuellement ; digest vide → abandon `resume_vide` ;
//  8. aucune PII dans les codes d'erreur.
// ---------------------------------------------------------------------------

interface ArgsFindMany {
  where?: unknown
  orderBy?: unknown
  take?: number
  select?: unknown
}

interface ArgsUpdateMany {
  where?: unknown
  data?: unknown
}

interface ArgsUpdate {
  where?: { id: number }
  data?: Record<string, unknown>
}

interface ArgsCount {
  where?: unknown
}

interface ArgsCreateMany {
  data?: unknown[]
  skipDuplicates?: boolean
}

interface LigneFixture {
  id: number
  destinataireId: number
  notificationId: number | null
  type: string | null
  resumeDu: Date | null
  tentatives: number
  notification: {
    titre: string
    contenu: string | null
    compteur: number
    type: string
  } | null
  destinataire: { email: string | null }
}

interface NotificationFixture {
  type: string
  titre: string
  contenu: string | null
}

const {
  emailFindMany,
  emailUpdateMany,
  emailUpdate,
  emailCount,
  emailCreateMany,
  notificationFindMany,
  reglageFindUnique,
  reglageFindMany,
  preferenceFindMany,
  envoyerEmailMock,
  estEnvoiConfigureMock,
} = vi.hoisted(() => ({
  emailFindMany: vi.fn<(args: ArgsFindMany) => Promise<LigneFixture[]>>(),
  emailUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
  emailUpdate: vi.fn<(args: ArgsUpdate) => Promise<unknown>>(),
  emailCount: vi.fn<(args: ArgsCount) => Promise<number>>(),
  emailCreateMany: vi.fn<(args: ArgsCreateMany) => Promise<{ count: number }>>(),
  notificationFindMany: vi.fn<(args: ArgsFindMany) => Promise<NotificationFixture[]>>(),
  reglageFindUnique: vi.fn<
    (args: { where: { userId: number } }) => Promise<{ emailsActives: boolean } | null>
  >(),
  reglageFindMany: vi.fn<
    (args: ArgsFindMany) => Promise<{ userId: number }[]>
  >(),
  preferenceFindMany: vi.fn<
    (args: { where: { userId: number } }) => Promise<{ type: string; emailActive: boolean }[]>
  >(),
  envoyerEmailMock: vi.fn<
    (params: { destinataire: string; email: { sujet: string; texte: string; html: string } }) => Promise<
      { ok: true } | { ok: false; erreur: string }
    >
  >(),
  estEnvoiConfigureMock: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailNotification: {
      findMany: emailFindMany,
      updateMany: emailUpdateMany,
      update: emailUpdate,
      count: emailCount,
      createMany: emailCreateMany,
    },
    notification: { findMany: notificationFindMany },
    notificationReglage: { findUnique: reglageFindUnique, findMany: reglageFindMany },
    notificationPreference: { findMany: preferenceFindMany },
  },
}))

vi.mock('@/lib/notifications-envoi', () => ({
  estEnvoiConfigure: estEnvoiConfigureMock,
  envoyerEmail: envoyerEmailMock,
}))

const MAINTENANT = new Date('2026-10-24T08:00:00.000Z')
const DESTINATAIRE = 'destinataire@exemple.test'

/** Ligne de file typée par défaut : un nouveau message prêt à partir. */
function ligneMessage(overrides: Partial<LigneFixture> = {}): LigneFixture {
  return {
    id: 1,
    destinataireId: 7,
    notificationId: 100,
    type: 'nouveauMessage',
    resumeDu: null,
    tentatives: 0,
    notification: {
      titre: 'Nouveau message de Marie Dupont',
      contenu: 'Marie Dupont vous a envoyé un message.',
      compteur: 3,
      type: 'nouveauMessage',
    },
    destinataire: { email: DESTINATAIRE },
    ...overrides,
  }
}

/** Données du dernier `emailNotification.update` (ou objet vide). */
function dernierUpdate(): Record<string, unknown> {
  return emailUpdate.mock.calls.at(-1)?.[0]?.data ?? {}
}

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', 'secret-de-test-m9-vague-3')

  emailFindMany.mockReset().mockResolvedValue([])
  emailUpdateMany.mockReset().mockResolvedValue({ count: 1 })
  emailUpdate.mockReset().mockResolvedValue(undefined)
  emailCount.mockReset().mockResolvedValue(0)
  emailCreateMany.mockReset().mockResolvedValue({ count: 1 })
  notificationFindMany.mockReset().mockResolvedValue([])
  reglageFindUnique.mockReset().mockResolvedValue(null)
  reglageFindMany.mockReset().mockResolvedValue([])
  preferenceFindMany.mockReset().mockResolvedValue([])
  envoyerEmailMock.mockReset().mockResolvedValue({ ok: true })
  estEnvoiConfigureMock.mockReset().mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('traiterFileEmails (configuration absente = no-op total)', () => {
  it('sans Resend configuré : aucune lecture, aucune écriture', async () => {
    estEnvoiConfigureMock.mockReturnValue(false)

    await expect(traiterFileEmails(MAINTENANT)).resolves.toEqual({
      configuration: false,
      examines: 0,
      envoyes: 0,
      reportes: 0,
      echecs: 0,
      abandons: 0,
    })
    expect(emailFindMany).not.toHaveBeenCalled()
    expect(emailUpdate).not.toHaveBeenCalled()
  })

  it('sans AUTH_SECRET : aucun envoi possible (lien de désabonnement impossible)', async () => {
    vi.stubEnv('AUTH_SECRET', '')

    const bilan = await traiterFileEmails(MAINTENANT)
    expect(bilan.configuration).toBe(false)
    expect(emailFindMany).not.toHaveBeenCalled()
  })
})

describe('traiterFileEmails (drain et réclamation)', () => {
  it('réclame, envoie puis marque `envoye` (erreur effacée, date posée)', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])

    const bilan = await traiterFileEmails(MAINTENANT)

    // Réclamation conditionnelle (statut + échéance) ...
    expect(emailUpdateMany).toHaveBeenCalledTimes(1)
    const claim = emailUpdateMany.mock.calls[0]?.[0]
    expect(claim?.where).toMatchObject({ id: 1, statut: 'enAttente' })
    expect(claim?.where).toHaveProperty('OR')
    // ... puis l'email part au bon destinataire.
    expect(envoyerEmailMock).toHaveBeenCalledTimes(1)
    const envoi = envoyerEmailMock.mock.calls[0]?.[0]
    expect(envoi?.destinataire).toBe(DESTINATAIRE)
    expect(envoi?.email.sujet).toContain('Nouveau message de Marie Dupont')
    // Un compteur > 1 ajoute la ligne de regroupement.
    expect(envoi?.email.texte).toContain('3 nouveaux messages')

    expect(emailUpdate.mock.calls[0]?.[0]?.where).toEqual({ id: 1 })
    expect(dernierUpdate()).toMatchObject({
      statut: 'envoye',
      envoyeLe: MAINTENANT,
      erreur: null,
      prochaineTentative: null,
      tentatives: { increment: 1 },
    })
    expect(bilan).toMatchObject({ examines: 1, envoyes: 1, echecs: 0, abandons: 0 })
  })

  it('réclamation perdue (count 0) : aucun envoi, aucun statut touché', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    emailUpdateMany.mockResolvedValue({ count: 0 })

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(emailUpdate).not.toHaveBeenCalled()
    expect(bilan).toMatchObject({ examines: 1, envoyes: 0, echecs: 0, abandons: 0 })
  })
})

describe('traiterFileEmails (échecs, reprise, abandon)', () => {
  it('premier échec réseau : tentative 1, reprise dans 5 min, code court', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    envoyerEmailMock.mockResolvedValue({ ok: false, erreur: 'reseau' })

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(dernierUpdate()).toMatchObject({ tentatives: 1, erreur: 'reseau' })
    expect(dernierUpdate().prochaineTentative).toEqual(new Date(MAINTENANT.getTime() + 5 * 60_000))
    expect(bilan).toMatchObject({ echecs: 1, abandons: 0 })
  })

  it('deuxième échec : reprise dans 20 min (backoff ×4)', async () => {
    emailFindMany.mockResolvedValue([ligneMessage({ tentatives: 1 })])
    envoyerEmailMock.mockResolvedValue({ ok: false, erreur: 'http_503' })

    await traiterFileEmails(MAINTENANT)

    expect(dernierUpdate()).toMatchObject({ tentatives: 2, erreur: 'http_503' })
    expect(dernierUpdate().prochaineTentative).toEqual(
      new Date(MAINTENANT.getTime() + 20 * 60_000),
    )
  })

  it(`échec n°${MAX_TENTATIVES} : abandon propre, plus jamais relancé`, async () => {
    emailFindMany.mockResolvedValue([ligneMessage({ tentatives: MAX_TENTATIVES - 1 })])
    envoyerEmailMock.mockResolvedValue({ ok: false, erreur: 'http_500' })

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(dernierUpdate()).toEqual({
      statut: 'abandonne',
      erreur: 'http_500',
      prochaineTentative: null,
      tentatives: MAX_TENTATIVES,
    })
    expect(bilan).toMatchObject({ echecs: 0, abandons: 1 })
  })

  it('l’erreur stockée est tronquée à 300 caractères (colonne VarChar)', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    envoyerEmailMock.mockResolvedValue({ ok: false, erreur: 'x'.repeat(400) })

    await traiterFileEmails(MAINTENANT)

    expect(String(dernierUpdate().erreur)).toHaveLength(300)
  })
})

describe('traiterFileEmails (préférences relues à l’envoi)', () => {
  it('compte désabonné → abandon `desactive`, aucun envoi', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    reglageFindUnique.mockResolvedValue({ emailsActives: false })

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toEqual({
      statut: 'abandonne',
      erreur: 'desactive',
      prochaineTentative: null,
    })
    expect(bilan.abandons).toBe(1)
  })

  it('type coupé par une préférence explicite → abandon `desactive`', async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    preferenceFindMany.mockResolvedValue([{ type: 'nouveauMessage', emailActive: false }])

    await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toMatchObject({ statut: 'abandonne', erreur: 'desactive' })
  })

  it('`signalementRecu` traverse le kill switch (non désactivable)', async () => {
    emailFindMany.mockResolvedValue([
      ligneMessage({
        type: 'signalementRecu',
        notification: {
          titre: 'Signalement reçu',
          contenu: null,
          compteur: 1,
          type: 'signalementRecu',
        },
      }),
    ])
    reglageFindUnique.mockResolvedValue({ emailsActives: false })

    await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).toHaveBeenCalledTimes(1)
    expect(dernierUpdate()).toMatchObject({ statut: 'envoye' })
  })

  it('destinataire sans adresse → abandon `destinataire_sans_email`', async () => {
    emailFindMany.mockResolvedValue([ligneMessage({ destinataire: { email: null } })])

    await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toMatchObject({
      statut: 'abandonne',
      erreur: 'destinataire_sans_email',
    })
  })

  it('notification liée absente → abandon `notification_absente`', async () => {
    emailFindMany.mockResolvedValue([ligneMessage({ notification: null })])

    await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toMatchObject({
      statut: 'abandonne',
      erreur: 'notification_absente',
    })
  })
})

describe('traiterFileEmails (plafonds anti-inondation)', () => {
  it(`6 emails envoyés dans l’heure → report d’1 h, sans tentative`, async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    emailCount.mockResolvedValueOnce(PLAFOND_HEURE).mockResolvedValueOnce(PLAFOND_HEURE)

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toEqual({
      prochaineTentative: new Date(MAINTENANT.getTime() + 60 * 60_000),
    })
    expect(bilan.reportes).toBe(1)
  })

  it(`30 emails sur 24 h → report de 24 h (priorité au plafond journalier)`, async () => {
    emailFindMany.mockResolvedValue([ligneMessage()])
    emailCount.mockResolvedValueOnce(0).mockResolvedValueOnce(PLAFOND_JOUR)

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toEqual({
      prochaineTentative: new Date(MAINTENANT.getTime() + 24 * 60 * 60_000),
    })
    expect(bilan.reportes).toBe(1)
  })

  it('compteur incrémenté après un envoi : le lot suivant voit le plafond', async () => {
    emailFindMany.mockResolvedValue([ligneMessage({ id: 1 }), ligneMessage({ id: 2 })])
    emailCount.mockResolvedValueOnce(PLAFOND_HEURE - 1).mockResolvedValueOnce(PLAFOND_HEURE - 1)

    const bilan = await traiterFileEmails(MAINTENANT)

    // Premier envoi (6e de l'heure), le second est reporté.
    expect(envoyerEmailMock).toHaveBeenCalledTimes(1)
    expect(bilan).toMatchObject({ envoyes: 1, reportes: 1 })
  })
})

describe('preparerResumesQuotidiens', () => {
  it('crée UNE ligne de digest datée du jour UTC, idempotente', async () => {
    reglageFindMany.mockResolvedValue([{ userId: 7 }])
    notificationFindMany.mockResolvedValue([
      { type: 'candidatureRecue', titre: 'Nouvelle candidature', contenu: 'Un candidat a postulé.' },
    ])

    const bilan = await preparerResumesQuotidiens(MAINTENANT)

    expect(bilan).toEqual({ candidats: 1, crees: 1 })
    expect(emailCreateMany).toHaveBeenCalledTimes(1)
    const data = emailCreateMany.mock.calls[0]?.[0]?.data ?? []
    expect(data).toEqual([
      {
        cle: 'email:resume:7:2026-10-24',
        destinataireId: 7,
        notificationId: null,
        type: null,
        resumeDu: new Date('2026-10-24T00:00:00.000Z'),
        statut: 'enAttente',
        tentatives: 0,
      },
    ])
    expect(emailCreateMany.mock.calls[0]?.[0]?.skipDuplicates).toBe(true)
  })

  it('aucune notification éligible → aucune ligne, aucun envoi', async () => {
    reglageFindMany.mockResolvedValue([{ userId: 7 }])
    notificationFindMany.mockResolvedValue([])

    const bilan = await preparerResumesQuotidiens(MAINTENANT)

    expect(bilan).toEqual({ candidats: 1, crees: 0 })
    expect(emailCreateMany).not.toHaveBeenCalled()
  })

  it('type coupé par une préférence → aucune ligne de digest', async () => {
    reglageFindMany.mockResolvedValue([{ userId: 7 }])
    notificationFindMany.mockResolvedValue([
      { type: 'offrePubliee', titre: 'Nouvelle offre', contenu: 'Une offre.' },
    ])
    preferenceFindMany.mockResolvedValue([{ type: 'offrePubliee', emailActive: false }])

    const bilan = await preparerResumesQuotidiens(MAINTENANT)

    expect(bilan.crees).toBe(0)
    expect(emailCreateMany).not.toHaveBeenCalled()
  })

  it('ne consulte QUE les comptes ayant activé le résumé ET les emails', async () => {
    await preparerResumesQuotidiens(MAINTENANT)

    expect(reglageFindMany.mock.calls[0]?.[0]?.where).toEqual({
      resumeQuotidien: true,
      emailsActives: true,
    })
  })

  it('sans configuration d’envoi : aucune préparation (pas de backlog périmé)', async () => {
    estEnvoiConfigureMock.mockReturnValue(false)

    const bilan = await preparerResumesQuotidiens(MAINTENANT)

    expect(bilan).toEqual({ candidats: 0, crees: 0 })
    expect(reglageFindMany).not.toHaveBeenCalled()
    expect(emailCreateMany).not.toHaveBeenCalled()
  })
})

describe('traiterFileEmails (digest)', () => {
  function ligneDigest(overrides: Partial<LigneFixture> = {}): LigneFixture {
    return {
      id: 9,
      destinataireId: 7,
      notificationId: null,
      type: null,
      resumeDu: new Date('2026-10-24T00:00:00.000Z'),
      tentatives: 0,
      notification: null,
      destinataire: { email: DESTINATAIRE },
      ...overrides,
    }
  }

  it('construit le résumé depuis les notifications éligibles de la fenêtre', async () => {
    emailFindMany.mockResolvedValue([ligneDigest()])
    notificationFindMany.mockResolvedValue([
      { type: 'candidatureRecue', titre: 'Nouvelle candidature', contenu: 'Un candidat a postulé.' },
      { type: 'offrePubliee', titre: 'Nouvelle offre', contenu: 'Une offre publiée.' },
    ])

    const bilan = await traiterFileEmails(MAINTENANT)

    // La fenêtre est [J-1, J) et exclut les notifications déjà emailées.
    const requete = notificationFindMany.mock.calls[0]?.[0]
    expect(requete?.where).toMatchObject({
      userId: 7,
      emails: { none: {} },
      createdAt: {
        gte: new Date('2026-10-23T00:00:00.000Z'),
        lt: new Date('2026-10-24T00:00:00.000Z'),
      },
    })

    expect(envoyerEmailMock).toHaveBeenCalledTimes(1)
    const envoi = envoyerEmailMock.mock.calls[0]?.[0]
    expect(envoi?.email.sujet).toBe(TEXTES.sujetEmailResume)
    expect(envoi?.email.texte).toContain(TEXTES.corpsEmailResume)
    expect(envoi?.email.texte).toContain('Un candidat a postulé.')
    // offrePubliee est OFF par défaut : exclue du digest.
    expect(envoi?.email.texte).not.toContain('Une offre publiée.')
    expect(dernierUpdate()).toMatchObject({ statut: 'envoye' })
    expect(bilan.envoyes).toBe(1)
  })

  it('digest devenu vide → abandon `resume_vide`, aucun envoi', async () => {
    emailFindMany.mockResolvedValue([ligneDigest()])
    notificationFindMany.mockResolvedValue([])

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toEqual({
      statut: 'abandonne',
      erreur: 'resume_vide',
      prochaineTentative: null,
    })
    expect(bilan.abandons).toBe(1)
  })

  it('digest périmé (> 48 h) → abandon `resume_perime`, aucune lecture', async () => {
    emailFindMany.mockResolvedValue([
      ligneDigest({ resumeDu: new Date('2026-10-21T00:00:00.000Z') }),
    ])

    const bilan = await traiterFileEmails(MAINTENANT)

    expect(notificationFindMany).not.toHaveBeenCalled()
    expect(envoyerEmailMock).not.toHaveBeenCalled()
    expect(dernierUpdate()).toEqual({
      statut: 'abandonne',
      erreur: 'resume_perime',
      prochaineTentative: null,
    })
    expect(bilan.abandons).toBe(1)
  })
})
