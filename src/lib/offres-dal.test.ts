import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma } from '@prisma/client'

import {
  SELECT_OFFRE_GESTION,
  SELECT_OFFRE_MODIFICATION,
  compterOffresPubliees,
  entrepriseDuCompte,
  lireOffreGestion,
  lireOffreModifiable,
  lireOffrePourAdmin,
  type OffreGestion,
  type OffreModification,
} from './offres-dal'

// ─── Tests de la couche de GESTION des offres (M6, Vague 1) ─────────────────
// Deux critères sont verrouillés ici :
// 1. ownership + existence + suppression logique sont portés par le MÊME
//    `where` d'UNE SEULE requête (aucune lecture puis seconde vérification) ;
// 2. offre étrangère / supprimée / inexistante → EXACTEMENT le même retour
//    (`null`), aucun indice distinct renvoyé à l'appelant : c'est ce `null`
//    qui déclenche le 404 uniforme côté action serveur.
// ---------------------------------------------------------------------------

interface ArgsFindFirst {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
}

interface ArgsCount {
  where?: Prisma.OffreWhereInput
}

interface ArgsEntrepriseFindUnique {
  where?: { userId: number }
  select?: { id: boolean }
}

// Le type de retour dépend du `select` appelé (gestion ou modification) :
// le mock reste volontairement `unknown` — les garanties se lisent sur les
// ARGS (where/select) et sur les types de retour stricts des fonctions DAL.
const { offreFindFirst, offreCount, entrepriseFindUnique } = vi.hoisted(() => ({
  offreFindFirst: vi.fn<(args: ArgsFindFirst) => Promise<unknown>>(),
  offreCount: vi.fn<(args: ArgsCount) => Promise<number>>(),
  entrepriseFindUnique: vi.fn<
    (args: ArgsEntrepriseFindUnique) => Promise<{ id: number } | null>
  >(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findFirst: offreFindFirst, count: offreCount },
    entreprise: { findUnique: entrepriseFindUnique },
  },
}))

/** Ligne de gestion (liste blanche étroite). */
const GESTION: OffreGestion = {
  id: 42,
  titre: 'Developpeur back-end',
  slug: 'developpeur-back-end-42',
  statut: 'publiee',
  dateExpiration: new Date('2026-12-30T23:00:00Z'),
  deletedAt: null,
  entrepriseId: 3,
  updatedAt: new Date('2026-10-02T10:00:00Z'),
}

/** Ligne de formulaire (pré-remplissage édition / duplication). */
const MODIFICATION: OffreModification = {
  titre: 'Developpeur back-end',
  description: 'Poste en télétravail.\n2 ans d’expérience minimum.',
  typeContrat: 'CDI',
  niveauExperience: 'junior',
  ville: 'Douala',
  pays: 'Cameroun',
  salaireMin: null,
  salaireMax: null,
  salaireVisible: false,
  dateExpiration: new Date('2026-12-30T23:00:00Z'),
  categorieId: 7,
  slug: 'developpeur-back-end-42',
  statut: 'brouillon',
  entrepriseId: 3,
  competences: [{ competence: { id: 7, nom: 'PHP' } }],
}

beforeEach(() => {
  offreFindFirst.mockReset()
  offreCount.mockReset()
  entrepriseFindUnique.mockReset()
  offreFindFirst.mockResolvedValue(null)
  offreCount.mockResolvedValue(0)
  entrepriseFindUnique.mockResolvedValue(null)
})

describe('entrepriseDuCompte', () => {
  it('renvoie l’id de l’entreprise du compte en UNE requête minimale', async () => {
    entrepriseFindUnique.mockResolvedValue({ id: 3 })

    expect(await entrepriseDuCompte(9)).toBe(3)

    expect(entrepriseFindUnique).toHaveBeenCalledTimes(1)
    expect(entrepriseFindUnique.mock.calls[0]?.[0]).toEqual({
      where: { userId: 9 },
      select: { id: true },
    })
  })

  it('compte sans entreprise → null (jamais d’erreur, jamais d’autre id)', async () => {
    entrepriseFindUnique.mockResolvedValue(null)

    expect(await entrepriseDuCompte(9)).toBeNull()
    expect(entrepriseFindUnique).toHaveBeenCalledTimes(1)
  })
})

describe('lireOffreGestion (ownership dans la même requête)', () => {
  it('pose id + entrepriseId + deletedAt dans LE même where, en une seule requête', async () => {
    offreFindFirst.mockResolvedValue(GESTION)

    const offre = await lireOffreGestion(42, 3)

    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ id: 42, entrepriseId: 3, deletedAt: null })
    expect(args?.select).toEqual(SELECT_OFFRE_GESTION)
    expect(offre).toEqual(GESTION)
  })

  it('offre étrangère, supprimée ou inexistante → null, sans aucun indice distinct', async () => {
    // Non trouvée pour cause d'ownership : même retour qu'une offre absente.
    offreFindFirst.mockResolvedValue(null)

    expect(await lireOffreGestion(42, 999)).toBeNull()

    const argsEtrangere = offreFindFirst.mock.calls[0]?.[0]
    expect(argsEtrangere?.where).toEqual({ id: 42, entrepriseId: 999, deletedAt: null })

    // Inexistante : MÊME forme de where, mêmes clés — impossible de
    // distinguer les deux cas d'après la requête ni d'après la réponse.
    expect(await lireOffreGestion(999, 3)).toBeNull()

    const argsInexistante = offreFindFirst.mock.calls[1]?.[0]
    expect(Object.keys(argsInexistante?.where ?? {}).sort()).toEqual([
      'deletedAt',
      'entrepriseId',
      'id',
    ])
    expect(argsInexistante?.where).toEqual({ id: 999, entrepriseId: 3, deletedAt: null })
  })
})

describe('lireOffrePourAdmin (surface D5)', () => {
  it('filtre l’existence et deletedAt SANS filtre entrepriseId', async () => {
    offreFindFirst.mockResolvedValue(MODIFICATION)

    const offre = await lireOffrePourAdmin(42)

    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ id: 42, deletedAt: null })
    // L'admin lit toutes les offres vivantes : aucun périmètre d'entreprise.
    expect(args?.where).not.toHaveProperty('entrepriseId')
    expect(args?.select).toEqual(SELECT_OFFRE_MODIFICATION)
    expect(offre).toEqual(MODIFICATION)
  })

  it('offre supprimée logiquement → null (même 404 qu’une offre absente)', async () => {
    offreFindFirst.mockResolvedValue(null)

    expect(await lireOffrePourAdmin(999)).toBeNull()

    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ id: 999, deletedAt: null })
    expect(args?.where).not.toHaveProperty('entrepriseId')
  })
})

describe('compterOffresPubliees (quota D4)', () => {
  it('compte uniquement publiées ET non supprimées, avec le where exact', async () => {
    offreCount.mockResolvedValue(7)

    expect(await compterOffresPubliees(3)).toBe(7)

    expect(offreCount).toHaveBeenCalledTimes(1)
    expect(offreCount.mock.calls[0]?.[0].where).toEqual({
      entrepriseId: 3,
      statut: 'publiee',
      deletedAt: null,
    })
    // Expire demain, hier ou jamais : aucune clause de date — les offres
    // publiées EXPIRÉES restent comptées (aucun cron ne bascule le statut).
    expect(offreCount.mock.calls[0]?.[0].where).not.toHaveProperty('dateExpiration')
  })
})

describe('lireOffreModifiable (édition / duplication)', () => {
  it('applique le where strict à trois clauses et la liste blanche de formulaire', async () => {
    offreFindFirst.mockResolvedValue(MODIFICATION)

    const offre = await lireOffreModifiable(42, 3)

    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ id: 42, entrepriseId: 3, deletedAt: null })
    expect(args?.select).toEqual(SELECT_OFFRE_MODIFICATION)
    expect(offre).toEqual(MODIFICATION)
    expect(offre?.competences).toEqual([{ competence: { id: 7, nom: 'PHP' } }])
  })

  it('offre étrangère ou inexistante → null (aucune distinction)', async () => {
    offreFindFirst.mockResolvedValue(null)

    expect(await lireOffreModifiable(42, 999)).toBeNull()

    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ id: 42, entrepriseId: 999, deletedAt: null })
    expect(args?.select).toEqual(SELECT_OFFRE_MODIFICATION)
  })
})

describe('listes blanches (verrou anti-fuite)', () => {
  it('la gestion n’expose ni coordonnées, ni relation entreprise/User', () => {
    expect(Object.keys(SELECT_OFFRE_GESTION).sort()).toEqual([
      'dateExpiration',
      'deletedAt',
      'entrepriseId',
      'id',
      'slug',
      'statut',
      'titre',
      'updatedAt',
    ])
    for (const interdite of [
      'emailContact',
      'telephone',
      'adresse',
      'siteWeb',
      'description',
      'vues',
      'entreprise',
      'candidatures',
    ]) {
      expect(SELECT_OFFRE_GESTION).not.toHaveProperty(interdite)
    }
  })

  it('la modification ne contient que les champs de formulaire + compétences', () => {
    expect(Object.keys(SELECT_OFFRE_MODIFICATION).sort()).toEqual([
      'categorieId',
      'competences',
      'dateExpiration',
      'description',
      'entrepriseId',
      'niveauExperience',
      'pays',
      'salaireMax',
      'salaireMin',
      'salaireVisible',
      'slug',
      'statut',
      'titre',
      'typeContrat',
      'ville',
    ])
    for (const interdite of [
      'emailContact',
      'telephone',
      'adresse',
      'siteWeb',
      'vues',
      'entreprise',
      'candidatures',
      'deletedAt',
    ]) {
      expect(SELECT_OFFRE_MODIFICATION).not.toHaveProperty(interdite)
    }
    // Id + nom des compétences transitent : l'id pour les cases cochées du
    // pré-remplissage et la re-création du pivot (duplication), le nom pour
    // l'affichage.
    expect(SELECT_OFFRE_MODIFICATION.competences).toEqual({
      select: { competence: { select: { id: true, nom: true } } },
    })
  })
})
