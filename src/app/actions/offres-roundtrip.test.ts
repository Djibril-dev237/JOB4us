import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Prisma } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'

import {
  offreEnValeurs,
  type OffreAPreRemplir,
  type ValeursOffre,
} from '@/app/(app)/recruteur/offres/valeurs-offre'
import { verifyRole } from '@/lib/dal'
import { entrepriseDuCompte, lireOffreModifiable, type OffreModification } from '@/lib/offres-dal'
import { checkRateLimit } from '@/lib/rate-limit'

import { creerOffre, enregistrerModificationsOffre } from './offres'

// ─── Roundtrip édition : cycle COMPLET + complétude de la liste blanche ──────
// valeurs-offre.test.ts verrouille les conversions UNE À UNE et offres.test.ts
// asserte le `data` d’update PARTIELLEMENT (titre, date, catégorie, pivot) :
// personne ne prouve que la chaîne réelle
//   OffreModification (DAL) → offreEnValeurs() → FormData aux noms EXACTS de
//   offre-form.tsx → OffreFormSchema + catalogues → champsSaisissables()
//   → prisma.offre.update
// restitue l’offre d’origine SANS perte silencieuse, SANS clé surnuméraire, et
// qu’une validation échouée n’écrit JAMAIS (pas d’écriture partielle).
// Mêmes motifs de mock que offres.test.ts (rôle, ownership, catalogues, update
// capturé, redirect/notFound qui lèvent) : aucun accès base, aucune donnée
// réelle — les fixtures imitent des lignes de catalogue plausibles.
// ---------------------------------------------------------------------------

const {
  offreCreate,
  offreUpdate,
  offreCount,
  categorieFindMany,
  competenceFindMany,
  transaction,
} = vi.hoisted(() => ({
  offreCreate: vi.fn(),
  offreUpdate: vi.fn(),
  offreCount: vi.fn(),
  categorieFindMany: vi.fn(),
  competenceFindMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { create: offreCreate, update: offreUpdate, count: offreCount },
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

// Le seau D6 est mocké MAIS les constantes de politique restent réelles
// (motif identical à offres.test.ts).
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...original, checkRateLimit: vi.fn(), recordAttempt: vi.fn() }
})

// redirect() et notFound() lèvent en production : les mocks font pareil, sinon
// l’action continuerait après son verdict et « aucune écriture » serait faux.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 42
const ENTREPRISE_ID = 3
const OFFRE_ID = 42
const CATEGORIE_ID = 7
const CATALOGUE_COMPETENCES = [11, 12]
const SALAIRE_MIN = 250_000
const SALAIRE_MAX = 400_000

/**
 * Offre « cuisine-complète » : TOUS les champs de formulaire non-défaut, dont
 * un type de contrat HORS CDI, des montants non nuls, la case salaire cochée
 * et une date future. C’est la ligne que le formulaire d’édition pré-remplit
 * (`lireOffreModifiable` → `offreEnValeurs`) et que l’action doit réécrire à
 * l’identique.
 *
 * Type = `OffreModification` (SELECT_OFFRE_MODIFICATION), la structure RÉELLE
 * consommée par `offreEnValeurs` sur la page d’édition — le `OffreDetail`
 * public n’a ni `categorieId` ni les ids du pivot.
 */
const FIXTURE: OffreModification = {
  titre: 'Développeur back-end confirmé',
  description:
    'Poste basé à Lagos.\n\nVous piloterez nos API internes.\n\n2 ans d’expérience minimum.',
  typeContrat: 'stage',
  niveauExperience: 'intermediaire',
  ville: 'Lagos',
  // Valeur DIFFÉRENTE de PAYS_OFFRE_PAR_DEFAUT (« Cameroun ») : si le champ
  // disparaissait du FormData, le défaut du schéma comblerait la clé et
  // l’assertion « aucune perte silencieuse » resterait verte pour rien.
  pays: 'Nigeria',
  // Decimal(10,2) réel (le pré-remplissage doit le réduire à « 250000 »).
  salaireMin: new Prisma.Decimal(SALAIRE_MIN),
  salaireMax: new Prisma.Decimal(SALAIRE_MAX),
  salaireVisible: true,
  // Minuit UTC strict : `toISOString().slice(0, 10)` doit être stable
  // aller-retour (le champ date ne porte QUE le jour).
  dateExpiration: new Date('2099-12-30T00:00:00.000Z'),
  categorieId: CATEGORIE_ID,
  slug: 'developpeur-back-end-42',
  statut: 'brouillon',
  entrepriseId: ENTREPRISE_ID,
  competences: [
    { competence: { id: 11, nom: 'React' } },
    { competence: { id: 12, nom: 'SQL' } },
  ],
}

/** Client transmis au callback de `$transaction` (motif offres.test.ts). */
const TX = {
  offre: {
    create: offreCreate,
    update: offreUpdate,
    count: offreCount,
  },
}

/**
 * Le FormData EXACT qu'`offre-form.tsx` soumet : mêmes `name=`, champ caché
 * `id` du mode édition, texte/selections TOUJOURS présents (un navigateur
 * envoie ses inputs, même vides), cases à cocher SEULEMENT cochées — la case
 * `salaire_visible` sans `value` n’émet `'on'` que cochée et la clé est
 * OMISE sinon — et AUCUNE intention (le bouton d’édition n’en porte pas).
 */
function formDataEdition(valeurs: ValeursOffre, idOffre: number): FormData {
  const donnees = new FormData()
  donnees.set('id', String(idOffre))
  donnees.set('titre', valeurs.titre)
  donnees.set('categorie_id', valeurs.categorie_id)
  donnees.set('description', valeurs.description)
  donnees.set('type_contrat', valeurs.type_contrat)
  donnees.set('niveau_experience', valeurs.niveau_experience)
  donnees.set('ville', valeurs.ville)
  donnees.set('pays', valeurs.pays)
  donnees.set('date_expiration', valeurs.date_expiration)
  donnees.set('salaire_min', valeurs.salaire_min)
  donnees.set('salaire_max', valeurs.salaire_max)
  if (valeurs.salaire_visible) {
    donnees.set('salaire_visible', 'on')
  }
  for (const competenceId of valeurs.competences) {
    donnees.append('competences', String(competenceId))
  }
  return donnees
}

/** Colonnes de formulaire de `champsSaisissables()` (la liste blanche). */
interface ColonnesFormulaire {
  titre: string
  description: string
  typeContrat: OffreModification['typeContrat']
  niveauExperience: OffreModification['niveauExperience']
  ville: string
  pays: string
  salaireMin: number | null
  salaireMax: number | null
  salaireVisible: boolean
  dateExpiration: Date
  categorieId: number
}

/** `data` du `prisma.offre.update` d’édition (colonnes + pivot remplacé). */
interface DonneesMiseAJour extends ColonnesFormulaire {
  competences: { deleteMany: Record<string, never>; create: Array<{ competenceId: number }> }
}

/** `data` du `prisma.offre.create` de création (colonnes + statut/propriété). */
interface DonneesCreation extends ColonnesFormulaire {
  statut: string
  entrepriseId: number
  slug: null
  competences: { create: Array<{ competenceId: number }> }
}

/** Premier appel de `prisma.offre.update` (where + data). */
function appelUpdate(): { where: Record<string, unknown>; data: DonneesMiseAJour } | undefined {
  return offreUpdate.mock.calls[0]?.[0] as
    | { where: Record<string, unknown>; data: DonneesMiseAJour }
    | undefined
}

/** `data` du premier `prisma.offre.update`, ou échec explicite du test. */
function miseAJour(): DonneesMiseAJour {
  const appel = appelUpdate()
  if (appel === undefined) {
    throw new Error('prisma.offre.update n’a jamais été appelé.')
  }
  return appel.data
}

/** `data` du premier `prisma.offre.create`, ou échec explicite du test. */
function donneesCreation(): DonneesCreation {
  const appel = offreCreate.mock.calls[0]?.[0] as { data: DonneesCreation } | undefined
  if (appel === undefined) {
    throw new Error('prisma.offre.create n’a jamais été appelé.')
  }
  return appel.data
}

/**
 * Reconstitue la ligne INSÉRÉE (le `data` écrit + l’id renvoyé par l’INSERT)
 * pour la replaquer dans le pré-remplissage : c’est la même opération que la
 * page d’édition face à une ligne fraîchement créée.
 */
function ligneCreee(): OffreAPreRemplir {
  const data = donneesCreation()
  return {
    titre: data.titre,
    description: data.description,
    typeContrat: data.typeContrat,
    niveauExperience: data.niveauExperience,
    ville: data.ville,
    pays: data.pays,
    salaireMin: data.salaireMin,
    salaireMax: data.salaireMax,
    salaireVisible: data.salaireVisible,
    dateExpiration: data.dateExpiration,
    categorieId: data.categorieId,
    competences: data.competences.create.map(({ competenceId }) => ({
      competence: { id: competenceId },
    })),
  }
}

/** Une action de formulaire réussit TOUJOURS par une redirection. */
async function attendRedirection(action: Promise<unknown>, url: string): Promise<void> {
  await expect(action).rejects.toThrow(`REDIRECT:${url}`)
  expect(redirect).toHaveBeenCalledWith(url)
  expect(notFound).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
  vi.mocked(entrepriseDuCompte).mockResolvedValue(ENTREPRISE_ID)
  vi.mocked(lireOffreModifiable).mockResolvedValue(FIXTURE)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 })

  categorieFindMany.mockResolvedValue([{ id: CATEGORIE_ID }])
  competenceFindMany.mockResolvedValue(CATALOGUE_COMPETENCES.map((id) => ({ id })))
  offreCreate.mockResolvedValue({ ...FIXTURE, id: OFFRE_ID })
  offreUpdate.mockResolvedValue({})
  offreCount.mockResolvedValue(0)
  transaction.mockImplementation(async (fn: (tx: typeof TX) => Promise<unknown>) => fn(TX))
})

// ─── 1. Roundtrip cuisine-complète ───────────────────────────────────────────

describe('roundtrip édition (pré-remplissage → FormData → update)', () => {
  it('restitue l’offre à l’identique et n’écrit que la liste blanche + le pivot', async () => {
    const valeurs = offreEnValeurs(FIXTURE, CATALOGUE_COMPETENCES)

    await attendRedirection(
      enregistrerModificationsOffre(undefined, formDataEdition(valeurs, OFFRE_ID)),
      '/recruteur/offres?maj=modifiee',
    )

    const appel = appelUpdate()
    const data = miseAJour()

    // Complétude DEUX SENS : ni colonne perdue (perte silencieuse de donnée),
    // ni clé hors formulaire (statut/entrepriseId/slug/id jamais écrits).
    expect(Object.keys(data).sort()).toEqual([
      'categorieId',
      'competences',
      'dateExpiration',
      'description',
      'niveauExperience',
      'pays',
      'salaireMax',
      'salaireMin',
      'salaireVisible',
      'titre',
      'typeContrat',
      'ville',
    ])

    // L’écriture reste doublement Ownership (id du payload + entreprise du
    // compte + ligne vivante).
    expect(appel?.where).toEqual({ id: OFFRE_ID, entrepriseId: ENTREPRISE_ID, deletedAt: null })

    // Valeur par valeur : le cycle renvoie la fixture d’origine.
    expect(data.titre).toBe(FIXTURE.titre)
    expect(data.description).toBe(FIXTURE.description)
    expect(data.typeContrat).toBe(FIXTURE.typeContrat)
    expect(data.niveauExperience).toBe(FIXTURE.niveauExperience)
    expect(data.ville).toBe(FIXTURE.ville)
    expect(data.pays).toBe(FIXTURE.pays)
    expect(data.salaireMin).toBe(SALAIRE_MIN)
    expect(data.salaireMax).toBe(SALAIRE_MAX)
    expect(data.salaireVisible).toBe(true)
    expect(data.categorieId).toBe(FIXTURE.categorieId)
    // Stabilité aller-retour du pré-remplissage : le champ date ne transporte
    // que le jour, reconstruit à minuit UTC — même instant que la colonne.
    expect(data.dateExpiration).toBeInstanceOf(Date)
    expect(new Date(data.dateExpiration).getTime()).toBe(FIXTURE.dateExpiration.getTime())

    // Pivot : remplacement intégral, ids du CATALOGUE dans l’ordre envoyé.
    expect(data.competences).toEqual({
      deleteMany: {},
      create: [{ competenceId: 11 }, { competenceId: 12 }],
    })

    expect(offreUpdate).toHaveBeenCalledTimes(1)
  })

  it('case salaire non cochée : la clé absente conserve salaireVisible à false', async () => {
    // Salaire min/max TOUJOURS renseignés : seule la case disparaît du
    // payload (comportement réel d’un navigateur sur une checkbox sans
    // `value`) — le schéma doit lire « clé omise » et non basculer en true.
    const valeurs = offreEnValeurs({ ...FIXTURE, salaireVisible: false }, CATALOGUE_COMPETENCES)
    const formData = formDataEdition(valeurs, OFFRE_ID)
    expect(formData.has('salaire_visible')).toBe(false)

    await attendRedirection(
      enregistrerModificationsOffre(undefined, formData),
      '/recruteur/offres?maj=modifiee',
    )

    const data = miseAJour()
    expect(data.salaireVisible).toBe(false)
    // Les montants, eux, sont bien repris : c’est la SEULE case qui manque.
    expect(data.salaireMin).toBe(SALAIRE_MIN)
    expect(data.salaireMax).toBe(SALAIRE_MAX)
  })

  it('description manquante : erreur de champ ET AUCUNE écriture', async () => {
    const formData = formDataEdition(offreEnValeurs(FIXTURE, CATALOGUE_COMPETENCES), OFFRE_ID)
    formData.delete('description')

    const result = await enregistrerModificationsOffre(undefined, formData)

    // Erreur de champ prête pour FormState, sous la clé du champ faillant.
    expect(result?.errors?.description?.[0]).toBeTruthy()
    // Jamais d’écriture partielle silencieuse après un refus de validation.
    expect(offreUpdate).not.toHaveBeenCalled()
    expect(offreCreate).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})

// ─── 4. Symétrie création → pré-remplissage ──────────────────────────────────

describe('symétrie création → pré-remplissage', () => {
  it('créée puis ré-affichée, l’offre produit les MÊMES valeurs de formulaire', async () => {
    const valeursEntree = offreEnValeurs(FIXTURE, CATALOGUE_COMPETENCES)

    await attendRedirection(
      creerOffre(undefined, formDataEdition(valeursEntree, OFFRE_ID)),
      '/recruteur/offres?maj=brouillon',
    )

    expect(offreCreate).toHaveBeenCalledTimes(1)
    // Le pivot de création porte les mêmes ids que l’entrée.
    expect(donneesCreation().competences).toEqual({
      create: [{ competenceId: 11 }, { competenceId: 12 }],
    })

    // Relecture de la ligne insérée par le MÊME pré-remplissage que l’édition :
    // création et édition parlent le langage de champs identique.
    const ressortie = offreEnValeurs(ligneCreee(), CATALOGUE_COMPETENCES)
    expect(ressortie).toEqual(valeursEntree)

    // Contrôles ponctuels indépendants de la comparaison ci-dessus : la
    // conversion doit VRAIMENT reconstituer les champs, pas seulement se
    // reproduire elle-même.
    expect(ressortie.salaire_min).toBe(String(SALAIRE_MIN))
    expect(ressortie.salaire_max).toBe(String(SALAIRE_MAX))
    expect(ressortie.date_expiration).toBe('2099-12-30')
    expect(ressortie.categorie_id).toBe(String(CATEGORIE_ID))
    expect(ressortie.competences).toEqual(CATALOGUE_COMPETENCES)
  })
})
