import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma } from '@prisma/client'

import {
  SELECT_OFFRE_ADMIN,
  compterOffresPourAdmin,
  listerOffresPourAdmin,
  type OffreAdminLigne,
} from './offres-admin-dal'

// ─── Tests de la couche de données de l'espace admin (M6, D5) ────────────────
// Trois critères verrouillés ici :
// 1. la liste = UNE SEULE findMany (jointures dans le select, zéro requête
//    par ligne) où `deletedAt: null`, tri legacy created_at DESC ;
// 2. les 3 cartes de stats = UNE transaction, avec les bornes EXACTES —
//    frontière d'expiration sur minuit Douala (jamais le fuseau serveur) ;
// 3. listes blanches de champs : l'écran admin ne reçoit ni coordonnées, ni
//    description, ni vues, ni clés d'écriture (entrepriseId, deletedAt…).
// ---------------------------------------------------------------------------

interface ArgsFindMany {
  where?: Prisma.OffreWhereInput
  orderBy?: Prisma.OffreOrderByWithRelationInput
  select?: Prisma.OffreSelect
}

interface ArgsCount {
  where?: Prisma.OffreWhereInput
}

// Le type de retour dépend du `select` appelé : le mock reste
// volontairement `unknown` — les garanties se lisent sur les ARGS
// (where/orderBy/select) et sur les types de retour stricts des fonctions
// DAL, eux, typés.
const { offreFindMany, offreCount, transaction } = vi.hoisted(() => ({
  offreFindMany: vi.fn<(args: ArgsFindMany) => Promise<unknown>>(),
  offreCount: vi.fn<(args: ArgsCount) => Promise<number>>(),
  transaction: vi.fn<(operations: Promise<unknown>[]) => Promise<unknown[]>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findMany: offreFindMany, count: offreCount },
    $transaction: transaction,
  },
}))

/** Ligne de la liste admin (DTO aligné sur les besoins de l'écran). */
const LIGNE: OffreAdminLigne = {
  id: 42,
  titre: 'Developpeur back-end',
  statut: 'publiee',
  dateExpiration: new Date('2026-12-30T23:00:00Z'),
  ville: 'Douala',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  entreprise: { nom: 'ACME Cameroun' },
  categorie: { nom: 'Informatique' },
}

beforeEach(() => {
  // Instant figé pour les bornes de date : 8 octobre 2026 midi UTC =
  // 13:00 le même jour à Douala (UTC+1, pas de DST au Cameroun).
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))

  offreFindMany.mockReset()
  offreCount.mockReset()
  transaction.mockReset()
  // `$transaction([...])` batch : on rejoue simplement les opérations.
  transaction.mockImplementation((operations) => Promise.all(operations))
  offreFindMany.mockResolvedValue([LIGNE])
  offreCount.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listerOffresPourAdmin', () => {
  it('UNE findMany : offres non supprimées, tri legacy created_at DESC, select exact', async () => {
    const lignes = await listerOffresPourAdmin()

    expect(offreFindMany).toHaveBeenCalledTimes(1)
    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ deletedAt: null })
    // `latest()` legacy (OffreAdminController@index) = created_at DESC.
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
    expect(args?.select).toEqual(SELECT_OFFRE_ADMIN)
    expect(lignes).toEqual([LIGNE])
    // Pas de compte ni de seconde lecture : la page tient en 1 requête.
    expect(offreCount).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('joint entreprise ET catégorie dans le select, sans include ni champ privé', async () => {
    await listerOffresPourAdmin()

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.select?.entreprise).toEqual({ select: { nom: true } })
    expect(args?.select?.categorie).toEqual({ select: { nom: true } })
    // Jamais d'include : le select porte déjà les deux relations (anti N+1).
    expect(args).not.toHaveProperty('include')

    expect(Object.keys(args?.select ?? {}).sort()).toEqual([
      'categorie',
      'createdAt',
      'dateExpiration',
      'entreprise',
      'id',
      'statut',
      'titre',
      'ville',
    ])
    for (const interdite of [
      'description',
      'emailContact',
      'telephone',
      'adresse',
      'siteWeb',
      'vues',
      'slug',
      'deletedAt',
      'entrepriseId',
      'candidatures',
      'competences',
    ]) {
      expect(args?.select).not.toHaveProperty(interdite)
    }
  })

  it('restitue une ligne dont les relations sont absentes (replis écran vivants)', async () => {
    offreFindMany.mockResolvedValue([
      { ...LIGNE, entreprise: null, categorie: null },
    ])

    const lignes = await listerOffresPourAdmin()

    expect(lignes[0]?.entreprise).toBeNull()
    expect(lignes[0]?.categorie).toBeNull()
  })
})

describe('compterOffresPourAdmin', () => {
  it('3 compteurs dans une SEULE transaction, avec les bornes exactes', async () => {
    offreCount
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)

    const comptes = await compterOffresPourAdmin()

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0]?.[0]).toHaveLength(3)
    expect(offreCount).toHaveBeenCalledTimes(3)
    expect(comptes).toEqual({ total: 12, publiees: 5, expirees: 2 })

    // Total : toutes les offres vivantes, aucun filtre de statut ni de date.
    expect(offreCount.mock.calls[0]?.[0].where).toEqual({ deletedAt: null })

    // Publiées : statut seul — les offres publiées DÉJÀ expirées restent
    // comptées (aucun cron ne bascule leur statut : T11 = dérivation seule).
    expect(offreCount.mock.calls[1]?.[0].where).toEqual({
      statut: 'publiee',
      deletedAt: null,
    })
    expect(offreCount.mock.calls[1]?.[0].where).not.toHaveProperty('dateExpiration')

    // Expirées : frontière Douala — minuit civil du 8 octobre à Douala
    // (23:00Z le 7), JAMAIS le minuit UTC ni l'heure locale du serveur.
    expect(offreCount.mock.calls[2]?.[0].where).toEqual({
      statut: 'publiee',
      deletedAt: null,
      dateExpiration: { lt: new Date('2026-10-07T23:00:00.000Z') },
    })
  })

  it('exclut les offres supprimées des 3 compteurs', async () => {
    await compterOffresPourAdmin()

    for (const appel of offreCount.mock.calls) {
      expect(appel[0].where).toHaveProperty('deletedAt', null)
    }
  })

  it('n’appelle aucune liste : compteurs et liste sont indépendants', async () => {
    await compterOffresPourAdmin()

    expect(offreFindMany).not.toHaveBeenCalled()
  })
})
