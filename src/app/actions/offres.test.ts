import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyRole } from '@/lib/dal'
import { ERREUR_CATEGORIE_INCONNUE } from '@/lib/definitions'
import {
  entrepriseDuCompte,
  lireOffreGestion,
  lireOffreModifiable,
  type OffreGestion,
  type OffreModification,
} from '@/lib/offres-dal'
import { MESSAGES_ERREUR_TRANSITION, OFFRES_ACTIVES_MAX } from '@/lib/offres-labels'
import {
  OFFRES_CREATION_MAX_PAR_COMPTE,
  OFFRES_CREATION_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'
import { notFound, redirect } from 'next/navigation'

import {
  cloturerOffre,
  creerOffre,
  dupliquerOffre,
  enregistrerModificationsOffre,
  publierOffre,
  rouvrirOffre,
  supprimerOffre,
} from './offres'

// ─── Tests des actions serveur des offres recruteur (M6, Vague 2) ────────────
// Critères verrouillés :
// 1. ordre imposé rôle → ownership → transition (une offre étrangère meurt en
//    404 AVANT tout contrôle de formulaire) ;
// 2. doctrine 404 : étrangère/inexistante/supprimée = mêmes symptômes qu'une
//    offre absente, JAMAIS un `?erreur=` ni un FormState distinct ;
// 3. matrice T1-T11 : les 7 retours `?maj=` et les 4 refus `?erreur=` ;
// 4. anti mass-assignment : `statut`, `entrepriseId`, `slug`, `id` forgeés
//    dans le FormData ne sortent JAMAIS dans le `data` / `where` réels.
// Aucune donnée réelle : prisma, dal, rate-limit et next/navigation sont
// mockés (redirect/notFound lèvent pour que le flux s'arrête comme en prod).
// ---------------------------------------------------------------------------

const {
  offreCreate,
  offreUpdate,
  offreUpdateMany,
  offreCount,
  categorieFindMany,
  competenceFindMany,
  transaction,
} = vi.hoisted(() => ({
  offreCreate: vi.fn(),
  offreUpdate: vi.fn(),
  offreUpdateMany: vi.fn(),
  offreCount: vi.fn(),
  categorieFindMany: vi.fn(),
  competenceFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: {
      create: offreCreate,
      update: offreUpdate,
      updateMany: offreUpdateMany,
      count: offreCount,
    },
    categorie: { findMany: categorieFindMany },
    competence: { findMany: competenceFindMany },
    $transaction: transaction,
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

vi.mock('@/lib/offres-dal', () => ({
  entrepriseDuCompte: vi.fn(),
  lireOffreGestion: vi.fn(),
  lireOffreModifiable: vi.fn(),
}))

// Le seau D6 est mocké (contrôle de sa valeur et de sa fenêtre) MAIS les
// constantes de politique sont celles du module réel : un écart de fenêtre
// ou de plafond casserait le contrat sans casser les assertions.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...original, checkRateLimit: vi.fn(), recordAttempt: vi.fn() }
})

// redirect() et notFound() lèvent en production : les mocks font pareil, sinon
// l'action continuerait après son verdict et les assertions de « pas d'écriture
// après refus » seraient fausses.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Client transmis au callback de `$transaction` : les mêmes spies servent
 * DANS la transaction et dehors, ce qui prouve que l'action ne passe que
 * par le tx pour écrire, et permet d'ordonner quota puis création.
 */
const TX = {
  offre: {
    create: offreCreate,
    update: offreUpdate,
    updateMany: offreUpdateMany,
    count: offreCount,
  },
}

const USER_ID = 42
const ENTREPRISE_ID = 3
const OFFRE_ID = 42

const GESTION_BROUILLON: OffreGestion = {
  id: OFFRE_ID,
  titre: 'Developpeur back-end',
  slug: 'developpeur-back-end-42',
  statut: 'brouillon',
  dateExpiration: new Date('2099-12-30T00:00:00.000Z'),
  deletedAt: null,
  entrepriseId: ENTREPRISE_ID,
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
}

const GESTION_PUBLIEE: OffreGestion = { ...GESTION_BROUILLON, statut: 'publiee' }

const GESTION_PUBLIEE_EXPIREE: OffreGestion = {
  ...GESTION_BROUILLON,
  statut: 'publiee',
  dateExpiration: new Date('2000-01-01T00:00:00.000Z'),
}

const GESTION_BROUILLON_PERIME: OffreGestion = {
  ...GESTION_BROUILLON,
  dateExpiration: new Date('2000-01-01T00:00:00.000Z'),
}

const GESTION_CLOTUREE: OffreGestion = { ...GESTION_BROUILLON, statut: 'cloturee' }

const GESTION_SUSPENDUE: OffreGestion = { ...GESTION_BROUILLON, statut: 'suspendue' }

const MODIFIABLE: OffreModification = {
  titre: 'Developpeur back-end',
  description: 'Poste en teletravail.\n2 ans d’expérience minimum.',
  typeContrat: 'CDI',
  niveauExperience: 'junior',
  ville: 'Douala',
  pays: 'Cameroun',
  salaireMin: null,
  salaireMax: null,
  salaireVisible: false,
  dateExpiration: new Date('2099-12-30T00:00:00.000Z'),
  categorieId: 7,
  slug: 'developpeur-back-end-42',
  statut: 'brouillon',
  entrepriseId: ENTREPRISE_ID,
  competences: [{ competence: { id: 7, nom: 'PHP' } }],
}

/** Formulaire valide et complet (l'intention est ABSENTE par défaut). */
const FORMULAIRE: Record<string, string | string[]> = {
  id: String(OFFRE_ID),
  titre: 'Developpeur back-end',
  categorie_id: '7',
  description: 'Poste en teletravail, 2 ans d’expérience minimum.',
  type_contrat: 'CDI',
  niveau_experience: 'junior',
  ville: 'Douala',
  pays: 'Cameroun',
  date_expiration: '2099-12-30',
  salaire_min: '250000',
  salaire_max: '400000',
  salaire_visible: 'on',
  competences: ['1', '2'],
}

function formOf(entries: Record<string, string | string[]>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const item of value) formData.append(key, item)
    } else {
      formData.set(key, value)
    }
  }
  return formData
}

/** Première ligne écrite par `prisma.offre.create` (data seul). */
function dataCreation(): Record<string, unknown> | undefined {
  return (offreCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined)?.data
}

/** Premier appel de `prisma.offre.update` (where + data). */
function appelUpdate(): { where: Record<string, unknown>; data: Record<string, unknown> } | undefined {
  return offreUpdate.mock.calls[0]?.[0] as
    | { where: Record<string, unknown>; data: Record<string, unknown> }
    | undefined
}

/** Premier appel de `prisma.offre.updateMany` (where + data). */
function appelUpdateMany():
  | { where: Record<string, unknown>; data: Record<string, unknown> }
  | undefined {
  return offreUpdateMany.mock.calls[0]?.[0] as
    | { where: Record<string, unknown>; data: Record<string, unknown> }
    | undefined
}

/** Une action de transition réussit (ou échoue) TOUJOURS par une redirection. */
async function attendRedirection(action: Promise<unknown>, url: string): Promise<void> {
  await expect(action).rejects.toThrow(`REDIRECT:${url}`)
  expect(redirect).toHaveBeenCalledWith(url)
  expect(notFound).not.toHaveBeenCalled()
}

/** Offre étrangère / inexistante / id mal formé : 404, et JAMAIS de redirection. */
async function attend404(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toThrow('NOT_FOUND')
  expect(notFound).toHaveBeenCalledTimes(1)
  expect(redirect).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
  vi.mocked(entrepriseDuCompte).mockResolvedValue(ENTREPRISE_ID)
  vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_BROUILLON)
  vi.mocked(lireOffreModifiable).mockResolvedValue(MODIFIABLE)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 })

  categorieFindMany.mockResolvedValue([{ id: 7 }])
  competenceFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
  offreCreate.mockResolvedValue({ id: OFFRE_ID })
  offreUpdate.mockResolvedValue({})
  offreUpdateMany.mockResolvedValue({ count: 1 })
  offreCount.mockResolvedValue(0)
  transaction.mockImplementation(async (fn: (tx: typeof TX) => Promise<unknown>) => fn(TX))
})

/** Rôles et ownership : la première ligne de contrôle des 7 actions. */
describe('ordre des contrôles', () => {
  const septActions: Array<() => Promise<unknown>> = [
    () => creerOffre(undefined, formOf(FORMULAIRE)),
    () => enregistrerModificationsOffre(undefined, formOf(FORMULAIRE)),
    () => publierOffre(formOf(FORMULAIRE)),
    () => cloturerOffre(formOf(FORMULAIRE)),
    () => rouvrirOffre(formOf(FORMULAIRE)),
    () => dupliquerOffre(formOf(FORMULAIRE)),
    () => supprimerOffre(formOf(FORMULAIRE)),
  ]

  it('exige le rôle recruteur EN PREMIER pour chacune des 7 actions', async () => {
    for (const action of septActions) {
      vi.mocked(verifyRole).mockClear()
      vi.mocked(verifyRole).mockRejectedValueOnce(new Error('STOP_ROLE'))

      await expect(action()).rejects.toThrow('STOP_ROLE')
      expect(verifyRole).toHaveBeenCalledWith('recruteur')
      expect(entrepriseDuCompte).not.toHaveBeenCalled()
      expect(lireOffreGestion).not.toHaveBeenCalled()
      expect(transaction).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
      expect(notFound).not.toHaveBeenCalled()
    }
  })

  it('répond un FormState si le recruteur n’a pas encore d’entreprise (création)', async () => {
    vi.mocked(entrepriseDuCompte).mockResolvedValue(null)

    const result = await creerOffre(undefined, formOf(FORMULAIRE))

    expect(result?.errors?._form?.[0]).toBe('Profil entreprise introuvable.')
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(categorieFindMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('répond 404 si le recruteur n’a pas d’entreprise pour une transition', async () => {
    vi.mocked(entrepriseDuCompte).mockResolvedValue(null)

    await attend404(supprimerOffre(formOf(FORMULAIRE)))
    expect(lireOffreGestion).not.toHaveBeenCalled()
  })

  it('refuse un id absent ou non entier par le MÊME 404 qu’une offre absente', async () => {
    await attend404(cloturerOffre(formOf({})))
  })

  it('refuse un id non entier positif sans même interroger le DAL', async () => {
    await attend404(rouvrirOffre(formOf({ id: '42.5' })))
    expect(lireOffreGestion).not.toHaveBeenCalled()
  })
})

// ─── T1 : création ───────────────────────────────────────────────────────────

describe('creerOffre', () => {
  it('enregistre un brouillon (intention absente) et redirige ?maj=brouillon', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=brouillon',
    )

    const data = dataCreation()
    expect(data?.statut).toBe('brouillon')
    expect(data?.entrepriseId).toBe(ENTREPRISE_ID)
    expect(data?.slug).toBeNull()
    expect(data?.dateExpiration).toEqual(new Date('2099-12-30'))
    expect(data?.typeContrat).toBe('CDI')
    expect(data?.niveauExperience).toBe('junior')
    expect(data?.categorieId).toBe(7)
    expect(data?.salaireMin).toBe(250000)
    expect(data?.salaireVisible).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('publie si intention = publier et redirige ?maj=publiee', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf({ ...FORMULAIRE, intention: 'publier' })),
      '/recruteur/offres?maj=publiee',
    )
    expect(dataCreation()?.statut).toBe('publiee')
  })

  it('construit le slug APRÈS l’insertion, dans la même transaction', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=brouillon',
    )

    expect(offreUpdate).toHaveBeenCalledWith({
      where: { id: OFFRE_ID },
      data: { slug: 'developpeur-back-end-42' },
    })
    expect(offreCreate).toHaveBeenCalledTimes(1)
    expect(offreUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(
      offreCreate.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('refuse avant toute écriture si D6 est épuisé', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterMs: 3_600_000 })

    const result = await creerOffre(undefined, formOf(FORMULAIRE))

    expect(result?.errors?._form?.[0]).toBe(MESSAGES_ERREUR_TRANSITION.limite)
    expect(checkRateLimit).toHaveBeenCalledWith(
      `offres:creation:${USER_ID}`,
      OFFRES_CREATION_MAX_PAR_COMPTE,
      OFFRES_CREATION_WINDOW_MS,
    )
    expect(categorieFindMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(offreCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('refuse D3 (date déjà passée à Douala) sans ouvrir de transaction', async () => {
    const result = await creerOffre(
      undefined,
      formOf({ ...FORMULAIRE, intention: 'publier', date_expiration: '2000-01-01' }),
    )

    expect(result?.errors?._form?.[0]).toBe(MESSAGES_ERREUR_TRANSITION.date)
    expect(transaction).not.toHaveBeenCalled()
    expect(offreCreate).not.toHaveBeenCalled()
  })

  it('accepte une date passée quand on reste en brouillon (D3 ne vaut qu’à la publication)', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf({ ...FORMULAIRE, date_expiration: '2000-01-01' })),
      '/recruteur/offres?maj=brouillon',
    )
    expect(dataCreation()?.dateExpiration).toEqual(new Date('2000-01-01'))
  })

  it('refuse D4 (quota atteint) sans créer de ligne', async () => {
    offreCount.mockResolvedValue(OFFRES_ACTIVES_MAX)

    const result = await creerOffre(
      undefined,
      formOf({ ...FORMULAIRE, intention: 'publier' }),
    )

    expect(result?.errors?._form?.[0]).toBe(MESSAGES_ERREUR_TRANSITION.quota)
    expect(offreCount).toHaveBeenCalledWith({
      where: { entrepriseId: ENTREPRISE_ID, statut: 'publiee', deletedAt: null },
    })
    expect(offreCreate).not.toHaveBeenCalled()
    expect(offreUpdate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('ne refuse jamais D4 pour une création en brouillon', async () => {
    offreCount.mockResolvedValue(OFFRES_ACTIVES_MAX)

    await attendRedirection(
      creerOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=brouillon',
    )
    expect(offreCount).not.toHaveBeenCalled()
    expect(dataCreation()?.statut).toBe('brouillon')
  })

  it('consomme le budget D6 seulement après l’écriture, avec la fenêtre d’1 h', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=brouillon',
    )

    expect(recordAttempt).toHaveBeenCalledTimes(1)
    expect(recordAttempt).toHaveBeenCalledWith(
      `offres:creation:${USER_ID}`,
      OFFRES_CREATION_WINDOW_MS,
    )
    expect(vi.mocked(recordAttempt).mock.invocationCallOrder[0]).toBeGreaterThan(
      offreCreate.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('retourne les erreurs du schéma sans rien écrire', async () => {
    const result = await creerOffre(undefined, formOf({ ...FORMULAIRE, titre: 'AB' }))

    expect(result?.errors?.titre?.[0]).toBeTruthy()
    expect(categorieFindMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('rejette une catégorie absente du catalogue avec la constante dédiée', async () => {
    const result = await creerOffre(
      undefined,
      formOf({ ...FORMULAIRE, categorie_id: '999' }),
    )

    expect(result?.errors?.categorie_id).toEqual([ERREUR_CATEGORIE_INCONNUE])
    expect(offreCreate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('n’écrit que les compétences présentes dans le catalogue', async () => {
    await attendRedirection(
      creerOffre(undefined, formOf({ ...FORMULAIRE, competences: ['1', '99', '99', '2'] })),
      '/recruteur/offres?maj=brouillon',
    )

    expect(dataCreation()?.competences).toEqual({
      create: [{ competenceId: 1 }, { competenceId: 2 }],
    })
  })

  it('ignore statut/entrepriseId/slug/vues/id injectés dans le payload', async () => {
    await attendRedirection(
      creerOffre(
        undefined,
        formOf({
          ...FORMULAIRE,
          statut: 'suspendue',
          entrepriseId: '999',
          slug: 'offre-volee-1',
          vues: '999',
          deletedAt: '2020-01-01',
        }),
      ),
      '/recruteur/offres?maj=brouillon',
    )

    const data = dataCreation()
    expect(data?.statut).toBe('brouillon')
    expect(data?.entrepriseId).toBe(ENTREPRISE_ID)
    // Le slug forgeé n'est pas repris : la colonne est insérée à null puis
    // reconstruite avec l'id RÉEL de la ligne.
    expect(data?.slug).toBeNull()
    for (const cleInterdite of ['vues', 'deletedAt', 'id', 'createdAt', 'updatedAt']) {
      expect(data).not.toHaveProperty(cleInterdite)
    }
    expect(offreUpdate).toHaveBeenCalledWith({
      where: { id: OFFRE_ID },
      data: { slug: 'developpeur-back-end-42' },
    })
  })
})

// ─── T3 + T7 : édition ───────────────────────────────────────────────────────

describe('enregistrerModificationsOffre', () => {
  it('réécrit le contenu et redirige ?maj=modifiee', async () => {
    await attendRedirection(
      enregistrerModificationsOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=modifiee',
    )

    const appel = appelUpdate()
    expect(appel?.where).toEqual({ id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, deletedAt: null })
    expect(appel?.data.titre).toBe('Developpeur back-end')
    expect(appel?.data.dateExpiration).toEqual(new Date('2099-12-30'))
    expect(appel?.data.categorieId).toBe(7)
    expect(appel?.data.competences).toEqual({
      deleteMany: {},
      create: [{ competenceId: 1 }, { competenceId: 2 }],
    })
  })

  it('ne réécrit JAMAIS statut, entrepriseId ni slug (T3 : statut inchangé)', async () => {
    await attendRedirection(
      enregistrerModificationsOffre(undefined, formOf(FORMULAIRE)),
      '/recruteur/offres?maj=modifiee',
    )

    const data = appelUpdate()?.data
    for (const cleInterdite of ['statut', 'entrepriseId', 'slug', 'id', 'deletedAt', 'vues']) {
      expect(data).not.toHaveProperty(cleInterdite)
    }
  })

  it('ignore l’intention publier : aucune transition de statut côté édition', async () => {
    await attendRedirection(
      enregistrerModificationsOffre(
        undefined,
        formOf({ ...FORMULAIRE, intention: 'publier', statut: 'publiee' }),
      ),
      '/recruteur/offres?maj=modifiee',
    )

    expect(appelUpdate()?.data).not.toHaveProperty('statut')
    expect(offreCount).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('accepte une date déjà passée : T7 prolonge sans contrôle D3/D4', async () => {
    await attendRedirection(
      enregistrerModificationsOffre(
        undefined,
        formOf({ ...FORMULAIRE, date_expiration: '2000-01-01' }),
      ),
      '/recruteur/offres?maj=modifiee',
    )

    expect(appelUpdate()?.data.dateExpiration).toEqual(new Date('2000-01-01'))
    expect(offreCount).not.toHaveBeenCalled()
  })

  it('retourne les erreurs du schéma sans écrire', async () => {
    const result = await enregistrerModificationsOffre(
      undefined,
      formOf({ ...FORMULAIRE, description: '' }),
    )

    expect(result?.errors?.description?.[0]).toBeTruthy()
    expect(offreUpdate).not.toHaveBeenCalled()
  })

  it('rejette une catégorie absente du catalogue avec la constante dédiée', async () => {
    const result = await enregistrerModificationsOffre(
      undefined,
      formOf({ ...FORMULAIRE, categorie_id: '999' }),
    )

    expect(result?.errors?.categorie_id).toEqual([ERREUR_CATEGORIE_INCONNUE])
    expect(offreUpdate).not.toHaveBeenCalled()
  })

  it('répond 404 (et jamais un FormState) pour une offre étrangère', async () => {
    vi.mocked(lireOffreModifiable).mockResolvedValue(null)

    await attend404(
      enregistrerModificationsOffre(undefined, formOf(FORMULAIRE)),
    )
    expect(offreUpdate).not.toHaveBeenCalled()
  })

  it('répond 404 si le payload désigne une autre ligne que celle du compte', async () => {
    vi.mocked(lireOffreModifiable).mockResolvedValue(null)

    await attend404(
      enregistrerModificationsOffre(undefined, formOf({ ...FORMULAIRE, id: '999' })),
    )
    expect(lireOffreModifiable).toHaveBeenCalledWith(999, ENTREPRISE_ID)
    expect(offreUpdate).not.toHaveBeenCalled()
  })
})

// ─── T2 : publier depuis la liste ────────────────────────────────────────────

describe('publierOffre', () => {
  it('publie un brouillon et redirige ?maj=publiee avec un CAS exact', async () => {
    await attendRedirection(publierOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=publiee')

    expect(appelUpdateMany()).toEqual({
      where: { id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, statut: 'brouillon', deletedAt: null },
      data: { statut: 'publiee' },
    })
    expect(offreCount).toHaveBeenCalledWith({
      where: { entrepriseId: ENTREPRISE_ID, statut: 'publiee', deletedAt: null },
    })
  })

  it('refuse depuis un statut autre que brouillon : ?erreur=statut', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_PUBLIEE)

    await attendRedirection(publierOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=statut')

    expect(transaction).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })

  it('refuse une offre déjà expirée : ?erreur=date (D3)', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_BROUILLON_PERIME)

    await attendRedirection(publierOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=date')

    expect(transaction).not.toHaveBeenCalled()
    expect(offreCount).not.toHaveBeenCalled()
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })

  it('refuse au quota : ?erreur=quota, sans CAS', async () => {
    offreCount.mockResolvedValue(OFFRES_ACTIVES_MAX)

    await attendRedirection(publierOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=quota')

    expect(offreUpdateMany).not.toHaveBeenCalled()
  })

  it('refuse si le CAS ne trouve plus la source (double clic) : ?erreur=statut', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(publierOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=statut')

    expect(appelUpdateMany()?.where).toMatchObject({ statut: 'brouillon' })
  })

  it('répond 404 pour une offre étrangère, sans ?erreur= ni écriture', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(publierOffre(formOf({ id: '999' })))
    expect(lireOffreGestion).toHaveBeenCalledWith(999, ENTREPRISE_ID)
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })
})

// ─── T4 / T5 : clôturer et rouvrir ───────────────────────────────────────────

describe('cloturerOffre', () => {
  it('clôture une publiée et redirige ?maj=cloturee avec un CAS exact', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_PUBLIEE)

    await attendRedirection(cloturerOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=cloturee')

    expect(appelUpdateMany()).toEqual({
      where: { id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, statut: 'publiee', deletedAt: null },
      data: { statut: 'cloturee' },
    })
  })

  it('reste autorisée sur une publiée EXPIRÉE (T11 : fermer est toujours sur)', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_PUBLIEE_EXPIREE)

    await attendRedirection(cloturerOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=cloturee')
    expect(appelUpdateMany()?.where).toEqual({
      id: OFFRE_ID,
      entrepriseId: ENTREPRISE_ID,
      statut: 'publiee',
      deletedAt: null,
    })
  })

  it('refuse si la source n’est pas publiée : ?erreur=statut', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_BROUILLON)
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(cloturerOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=statut')
    expect(offreUpdateMany).toHaveBeenCalledTimes(1)
  })

  it('répond 404 (et jamais ?erreur=) pour une offre étrangère', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(cloturerOffre(formOf({ id: '999' })))
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })
})

describe('rouvrirOffre', () => {
  it('rouvre une clôturée en brouillon et redirige ?maj=rouverte', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_CLOTUREE)

    await attendRedirection(rouvrirOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=rouverte')

    expect(appelUpdateMany()).toEqual({
      where: { id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, statut: 'cloturee', deletedAt: null },
      data: { statut: 'brouillon' },
    })
  })

  it('refuse si la source n’est pas clôturée : ?erreur=statut', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_PUBLIEE)
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(rouvrirOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=statut')
    expect(appelUpdateMany()?.where).toMatchObject({ statut: 'cloturee' })
  })

  it('répond 404 (et jamais ?erreur=) pour une offre étrangère', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(rouvrirOffre(formOf({ id: '999' })))
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })
})

// ─── T6 : dupliquer ──────────────────────────────────────────────────────────

describe('dupliquerOffre', () => {
  it('crée une NOUVELLE ligne en brouillon et redirige ?maj=dupliquee', async () => {
    offreCreate.mockResolvedValue({ id: 77 })

    await attendRedirection(dupliquerOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=dupliquee')

    const data = dataCreation()
    expect(data?.statut).toBe('brouillon')
    expect(data?.entrepriseId).toBe(ENTREPRISE_ID)
    expect(data?.slug).toBeNull()
    expect(data?.vues).toBe(0)
    expect(data?.titre).toBe(MODIFIABLE.titre)
    expect(data?.dateExpiration).toEqual(MODIFIABLE.dateExpiration)
    expect(data?.competences).toEqual({ create: [{ competenceId: 7 }] })
    // Le slug de la copie porte le NOUVEL id, jamais celui de la source.
    expect(offreUpdate).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { slug: 'developpeur-back-end-77' },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('consomme le budget D6 avec la même clé et la même fenêtre qu’une création', async () => {
    await attendRedirection(dupliquerOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=dupliquee')

    expect(checkRateLimit).toHaveBeenCalledWith(
      `offres:creation:${USER_ID}`,
      OFFRES_CREATION_MAX_PAR_COMPTE,
      OFFRES_CREATION_WINDOW_MS,
    )
    expect(recordAttempt).toHaveBeenCalledWith(
      `offres:creation:${USER_ID}`,
      OFFRES_CREATION_WINDOW_MS,
    )
    expect(vi.mocked(recordAttempt).mock.invocationCallOrder[0]).toBeGreaterThan(
      offreCreate.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('refuse une offre suspendue : ?erreur=statut, avant même le seau D6', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(GESTION_SUSPENDUE)

    await attendRedirection(dupliquerOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=statut')

    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(lireOffreModifiable).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(offreCreate).not.toHaveBeenCalled()
  })

  it('refuse si D6 est épuisé : ?erreur=limite, sans écriture', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterMs: 3_600_000 })

    await attendRedirection(dupliquerOffre(formOf(FORMULAIRE)), '/recruteur/offres?erreur=limite')

    expect(lireOffreModifiable).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(offreCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('répond 404 pour une offre étrangère sans cloner sa ligne', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(dupliquerOffre(formOf({ id: '999' })))
    expect(offreCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
  })
})

// ─── T10 : supprimer ─────────────────────────────────────────────────────────

describe('supprimerOffre', () => {
  it('remplit deletedAt (suppression LOGIQUE) et redirige ?maj=supprimee', async () => {
    await attendRedirection(supprimerOffre(formOf(FORMULAIRE)), '/recruteur/offres?maj=supprimee')

    expect(appelUpdateMany()).toEqual({
      where: { id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    // Jamais de suppression physique : updateMany est la seule écriture.
    expect(offreCreate).not.toHaveBeenCalled()
    expect(offreUpdate).not.toHaveBeenCalled()
  })

  it('refuse un second passage (ligne déjà supprimée) : ?erreur=statut', async () => {
    offreUpdateMany.mockResolvedValue({ count: 0 })

    await attendRedirection(
      supprimerOffre(formOf(FORMULAIRE)),
      '/recruteur/offres?erreur=statut',
    )
    expect(appelUpdateMany()?.where).toEqual({
      id: OFFRE_ID,
      entrepriseId: ENTREPRISE_ID,
      deletedAt: null,
    })
  })

  it('répond 404 pour une offre étrangère, sans y toucher', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(supprimerOffre(formOf({ id: '999' })))
    expect(offreUpdateMany).not.toHaveBeenCalled()
  })
})

// ─── Payload forge (anti mass-assignment sur les transitions) ────────────────

describe('payload forge', () => {
  it('n’écrit ni le statut ni l’entreprise injectés : le CAS porte la session', async () => {
    await attendRedirection(
      supprimerOffre(
        formOf({ ...FORMULAIRE, statut: 'suspendue', entrepriseId: '999' }),
      ),
      '/recruteur/offres?maj=supprimee',
    )

    const appel = appelUpdateMany()
    // Où : la session (entreprise 3) + deletedAt null, JAMAIS entrepriseId 999.
    expect(appel?.where).toEqual({
      id: OFFRE_ID,
      entrepriseId: ENTREPRISE_ID,
      deletedAt: null,
    })
    // Quoi : uniquement deletedAt — le statut forgeé n’est pas relu.
    expect(appel?.data).toEqual({ deletedAt: expect.any(Date) })
    expect(appel?.data).not.toHaveProperty('statut')
  })

  it('passe par le DAL avec l’id du payload ET l’entreprise de la session', async () => {
    vi.mocked(lireOffreGestion).mockResolvedValue(null)

    await attend404(publierOffre(formOf({ id: '999', entrepriseId: '3' })))
    expect(lireOffreGestion).toHaveBeenCalledWith(999, ENTREPRISE_ID)
    expect(entrepriseDuCompte).toHaveBeenCalledWith(USER_ID)
  })
})
