import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma, StatutCandidature, StatutOffre, TypeContrat } from '@prisma/client'

import {
  CANDIDATURES_PAR_PAGE,
  compteursCandidaturesRecruteur,
  detailCandidatureAdmin,
  detailCandidatureCandidat,
  detailCandidatureRecruteur,
  listerCandidaturesAdmin,
  listerCandidaturesCandidat,
  listerCandidaturesOffre,
  listerCandidaturesRecruteur,
  type CandidatureCandidat,
  type CandidatureCandidatDetail,
  type CandidatureRecruteur,
  type CandidatureRecruteurDetail,
  type ResultatListeCandidatures,
} from './candidatures-dal'

// ─── Tests de la couche d'accès aux données des candidatures (M7) ────────────
// Quatre critères sont verrouillés ici :
// 1. le contrôle d'appartenance est DANS le `where` de la requête qui lit —
//    `candidatId` côté candidat, `offre: { entreprise: { userId } }` côté
//    recruteur — jamais une lecture puis une vérification ;
// 2. toute entité étrangère → EXACTEMENT le même `null` qu'une entité
//    absente (la page enchaîne sur notFound() : 404 uniforme, jamais 403) ;
// 3. les `select` sont des listes blanches : §2.5 (aucun champ de profil,
//    aucune clé de fichier dans le DTO) ;
// 4. pagination et filtres sont propagés tels quels à Prisma.
// Aucune écriture n'est testée parce qu'aucune n'existe : le mock Prisma
// n'expose que findFirst/findMany/count/groupBy — un create/update/delete
// y lèverait une TypeError et ferait échouer le test.
// ---------------------------------------------------------------------------

interface ArgsCandidatureFindFirst {
  where?: Prisma.CandidatureWhereInput
  select?: Prisma.CandidatureSelect
}

interface ArgsCandidatureFindMany {
  where?: Prisma.CandidatureWhereInput
  select?: Prisma.CandidatureSelect
  orderBy?: Prisma.CandidatureOrderByWithRelationInput
  skip?: number
  take?: number
}

interface ArgsCandidatureCount {
  where?: Prisma.CandidatureWhereInput
}

interface ArgsCandidatureGroupBy {
  by?: string[]
  where?: Prisma.CandidatureWhereInput
  _count?: boolean | Prisma.CandidatureCountAggregateInputType
}

interface ArgsOffreFindFirst {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
}

// Le type de retour dépend du `select` appelé (liste candidat, détail
// recruteur…) : le mock reste volontairement `unknown` — les garanties se
// lisent sur les ARGS (where/select/orderBy/skip) et sur les types de
// retour stricts des fonctions de la DAL.
const {
  candidatureFindFirst,
  candidatureFindMany,
  candidatureCount,
  candidatureGroupBy,
  offreFindFirst,
} = vi.hoisted(() => ({
  candidatureFindFirst: vi.fn<(args: ArgsCandidatureFindFirst) => Promise<unknown>>(),
  candidatureFindMany: vi.fn<(args: ArgsCandidatureFindMany) => Promise<unknown>>(),
  candidatureCount: vi.fn<(args: ArgsCandidatureCount) => Promise<number>>(),
  candidatureGroupBy: vi.fn<(args: ArgsCandidatureGroupBy) => Promise<unknown>>(),
  offreFindFirst: vi.fn<(args: ArgsOffreFindFirst) => Promise<unknown>>(),
}))

// Prisma n'expose QUE les méthodes testées : toute requête absente (ou une
// écriture) lèverait une TypeError et ferait échouer le test.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidature: {
      findFirst: candidatureFindFirst,
      findMany: candidatureFindMany,
      count: candidatureCount,
      groupBy: candidatureGroupBy,
    },
    offre: { findFirst: offreFindFirst },
  },
}))

// ─── Lignes brutes (forme exacte des selects du DAL) ─────────────────────────

interface SourceOffre {
  id: number
  titre: string
  slug: string | null
  ville: string
  typeContrat: TypeContrat
  statut: StatutOffre
  dateExpiration: Date
  deletedAt: Date | null
  entreprise: { nom: string }
}

interface SourceCandidatureCandidat {
  id: number
  statut: StatutCandidature
  createdAt: Date
  lettreMotivation: string | null
  offre: SourceOffre
}

interface SourceCandidatureCandidatDetail extends SourceCandidatureCandidat {
  cvPath: string | null
}

interface SourceCandidatureRecruteur {
  id: number
  statut: StatutCandidature
  createdAt: Date
  lettreMotivation: string | null
  candidat: {
    titreProfil: string | null
    user: { name: string; email: string | null }
  }
  offre: { id: number; titre: string }
}

interface SourceCandidatureRecruteurDetail extends SourceCandidatureRecruteur {
  cvPath: string | null
  offre: {
    id: number
    titre: string
    slug: string | null
    ville: string
    typeContrat: TypeContrat
    statut: StatutOffre
    dateExpiration: Date
    deletedAt: Date | null
  }
}

/** Offre publiée, non supprimée, dont la date est très loin devant. */
const OFFRE_PUBLIEE: SourceOffre = {
  id: 42,
  titre: 'Developpeur back-end',
  slug: 'developpeur-back-end-42',
  ville: 'Douala',
  typeContrat: 'CDI',
  statut: 'publiee',
  dateExpiration: new Date('2099-12-31T23:00:00Z'),
  deletedAt: null,
  entreprise: { nom: 'Aster Technologies' },
}

const LIGNE_CANDIDAT: SourceCandidatureCandidat = {
  id: 91,
  statut: 'envoyee',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  lettreMotivation: 'Je souhaite rejoindre votre equipe.',
  offre: OFFRE_PUBLIEE,
}

const LIGNE_CANDIDAT_DETAIL: SourceCandidatureCandidatDetail = {
  ...LIGNE_CANDIDAT,
  cvPath: 'candidatures/cv-91.pdf',
}

const LIGNE_RECRUTEUR: SourceCandidatureRecruteur = {
  id: 91,
  statut: 'entretien',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  lettreMotivation: 'Je souhaite rejoindre votre equipe.',
  candidat: {
    titreProfil: 'Developpeuse back-end',
    user: { name: 'Awa Ngo', email: 'awa.ngo@example.com' },
  },
  offre: { id: 42, titre: 'Developpeur back-end' },
}

const LIGNE_RECRUTEUR_DETAIL: SourceCandidatureRecruteurDetail = {
  ...LIGNE_RECRUTEUR,
  cvPath: 'candidatures/cv-91.pdf',
  offre: {
    id: 42,
    titre: 'Developpeur back-end',
    slug: 'developpeur-back-end-42',
    ville: 'Douala',
    typeContrat: 'CDI',
    statut: 'publiee',
    dateExpiration: new Date('2099-12-31T23:00:00Z'),
    deletedAt: null,
  },
}

const SELECT_LISTE_RECRUTEUR = {
  id: true,
  statut: true,
  createdAt: true,
  lettreMotivation: true,
  candidat: {
    select: { titreProfil: true, user: { select: { name: true, email: true } } },
  },
  offre: { select: { id: true, titre: true } },
}

beforeEach(() => {
  candidatureFindFirst.mockReset()
  candidatureFindMany.mockReset()
  candidatureCount.mockReset()
  candidatureGroupBy.mockReset()
  offreFindFirst.mockReset()
  candidatureFindFirst.mockResolvedValue(null)
  candidatureFindMany.mockResolvedValue([])
  candidatureCount.mockResolvedValue(0)
  candidatureGroupBy.mockResolvedValue([])
  offreFindFirst.mockResolvedValue(null)
})

// ─── Côté candidat ───────────────────────────────────────────────────────────

describe('listerCandidaturesCandidat (périmètre du candidat)', () => {
  it('porte candidatId dans LE même where, avec count + findMany en parallèle', async () => {
    candidatureFindMany.mockResolvedValue([LIGNE_CANDIDAT])
    candidatureCount.mockResolvedValue(1)

    const resultat: ResultatListeCandidatures<CandidatureCandidat> =
      await listerCandidaturesCandidat(5)

    expect(candidatureCount).toHaveBeenCalledTimes(1)
    expect(candidatureFindMany).toHaveBeenCalledTimes(1)

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ candidatId: 5 })
    // Index (candidatId, createdAt) : tri couvert, pas de filesort.
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
    expect(args?.skip).toBe(0)
    expect(args?.take).toBe(CANDIDATURES_PAR_PAGE)

    // Aucune requête par ligne (la jointure offre/entreprise est dans le select).
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureGroupBy).not.toHaveBeenCalled()

    // Verrouillage du DTO : la liste n'émet ni lettre complète, ni clé cvPath.
    expect(resultat).toEqual({
      items: [
        {
          id: 91,
          statut: 'envoyee',
          createdAt: new Date('2026-10-01T09:00:00Z'),
          lettreExtrait: 'Je souhaite rejoindre votre equipe.',
          offre: {
            id: 42,
            titre: 'Developpeur back-end',
            slug: 'developpeur-back-end-42',
            ville: 'Douala',
            typeContrat: 'CDI',
            statut: 'publiee',
            dateExpiration: new Date('2099-12-31T23:00:00Z'),
            deletedAt: null,
            nomEntreprise: 'Aster Technologies',
          },
          offreRetiree: false,
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    })
    expect(Object.keys(resultat.items[0]).sort()).toEqual([
      'createdAt',
      'id',
      'lettreExtrait',
      'offre',
      'offreRetiree',
      'statut',
    ])
    expect(resultat.items[0]).not.toHaveProperty('cvPath')
    expect(resultat.items[0]).not.toHaveProperty('lettreMotivation')
  })

  it('pages = max(1, ceil(total / 15)) : 0 ligne → 1 page', async () => {
    candidatureCount.mockResolvedValue(0)

    const resultat = await listerCandidaturesCandidat(5)

    expect(resultat).toEqual({ items: [], total: 0, page: 1, pages: 1 })
  })

  it('filtre statut propagé, et absence de clause de statut sans filtre', async () => {
    await listerCandidaturesCandidat(5, { statut: 'refusee' })
    expect(candidatureFindMany.mock.calls[0]?.[0].where).toEqual({
      candidatId: 5,
      statut: 'refusee',
    })

    await listerCandidaturesCandidat(5)
    const where = candidatureFindMany.mock.calls[1]?.[0].where
    expect(where).toEqual({ candidatId: 5 })
    expect(where).not.toHaveProperty('statut')
  })

  it('un offreId étranger reste INTERSECTÉ au candidatId (liste vidée, jamais élargie)', async () => {
    await listerCandidaturesCandidat(5, { offreId: 77 })

    expect(candidatureFindMany.mock.calls[0]?.[0].where).toEqual({
      candidatId: 5,
      offreId: 77,
    })
    expect(candidatureCount.mock.calls[0]?.[0].where).toEqual({
      candidatId: 5,
      offreId: 77,
    })
  })
})

describe('lettreExtrait (troncature legacy Str::limit 120)', () => {
  it('lettre courte → identique, lettre nulle → null', async () => {
    candidatureFindMany.mockResolvedValue([LIGNE_CANDIDAT])

    const resultat = await listerCandidaturesCandidat(5)
    expect(resultat.items[0].lettreExtrait).toBe('Je souhaite rejoindre votre equipe.')

    candidatureFindMany.mockResolvedValue([{ ...LIGNE_CANDIDAT, lettreMotivation: null }])
    const sansLettre = await listerCandidaturesCandidat(5)
    expect(sansLettre.items[0].lettreExtrait).toBeNull()
  })

  it('lettre longue → 120 caractères au total, points de suspension compris', async () => {
    candidatureFindMany.mockResolvedValue([
      { ...LIGNE_CANDIDAT, lettreMotivation: 'a'.repeat(400) },
    ])

    const resultat = await listerCandidaturesCandidat(5)
    const extrait = resultat.items[0].lettreExtrait

    expect(extrait).not.toBeNull()
    expect(extrait?.length).toBe(120)
    expect(extrait?.endsWith('…')).toBe(true)
    expect(extrait?.startsWith('a'.repeat(119))).toBe(true)
  })

  it('exactement 120 caractères → aucune troncature ni suffixe', async () => {
    candidatureFindMany.mockResolvedValue([
      { ...LIGNE_CANDIDAT, lettreMotivation: 'b'.repeat(120) },
    ])

    const resultat = await listerCandidaturesCandidat(5)
    expect(resultat.items[0].lettreExtrait).toBe('b'.repeat(120))
  })
})

describe('offreRetiree (dérivé, distinct de « expirée »)', () => {
  async function offreRetireePour(offre: SourceOffre): Promise<{
    retiree: boolean
    statutOffre: StatutOffre
  }> {
    candidatureFindMany.mockResolvedValue([{ ...LIGNE_CANDIDAT, offre }])
    const resultat = await listerCandidaturesCandidat(5)
    return {
      retiree: resultat.items[0].offreRetiree,
      statutOffre: resultat.items[0].offre.statut,
    }
  }

  it('publiee non supprimée → false', async () => {
    expect(await offreRetireePour(OFFRE_PUBLIEE)).toEqual({
      retiree: false,
      statutOffre: 'publiee',
    })
  })

  it('deletedAt non nul → true (même si le statut reste publiee)', async () => {
    expect(
      (
        await offreRetireePour({
          ...OFFRE_PUBLIEE,
          deletedAt: new Date('2026-10-05T12:00:00Z'),
        })
      ).retiree,
    ).toBe(true)
  })

  it('brouillon → true ; suspendue → true (jamais consultables côté candidat)', async () => {
    expect((await offreRetireePour({ ...OFFRE_PUBLIEE, statut: 'brouillon' })).retiree).toBe(
      true,
    )
    expect((await offreRetireePour({ ...OFFRE_PUBLIEE, statut: 'suspendue' })).retiree).toBe(
      true,
    )
    expect((await offreRetireePour({ ...OFFRE_PUBLIEE, statut: 'cloturee' })).retiree).toBe(
      true,
    )
  })

  it('publiee mais EXPIRÉE → false : l’expiration s’affiche via statutAffiche, pas ici', async () => {
    const resultat = await offreRetireePour({
      ...OFFRE_PUBLIEE,
      dateExpiration: new Date('2020-01-01T23:00:00Z'),
    })

    expect(resultat.retiree).toBe(false)
    // Le statut stocké reste tel quel : la page dérive « Expirée » elle-même.
    expect(resultat.statutOffre).toBe('publiee')
  })
})

describe('detailCandidatureCandidat (ownership dans la même requête)', () => {
  it('candidature d’un AUTRE candidat → null, avec candidatId dans LE where', async () => {
    candidatureFindFirst.mockResolvedValue(null)

    const detail: CandidatureCandidatDetail | null = await detailCandidatureCandidat(1, 77)

    expect(detail).toBeNull()
    expect(candidatureFindFirst).toHaveBeenCalledTimes(1)
    expect(candidatureFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 77, candidatId: 1 })
  })

  it('ligne propre → lettre COMPLÈTE + cvSelectionne, sans clé cvPath dans le DTO', async () => {
    candidatureFindFirst.mockResolvedValue(LIGNE_CANDIDAT_DETAIL)

    const detail = await detailCandidatureCandidat(5, 91)

    expect(detail?.lettreMotivation).toBe('Je souhaite rejoindre votre equipe.')
    expect(detail?.cvSelectionne).toBe(true)
    expect(detail?.offreRetiree).toBe(false)
    expect(detail?.offre.nomEntreprise).toBe('Aster Technologies')
    expect(detail).not.toHaveProperty('cvPath')

    expect(Object.keys(detail ?? {}).sort()).toEqual([
      'createdAt',
      'cvSelectionne',
      'id',
      'lettreExtrait',
      'lettreMotivation',
      'offre',
      'offreRetiree',
      'statut',
    ])
  })

  it('cvPath nul → cvSelectionne false (le booléen seul porte l’information)', async () => {
    candidatureFindFirst.mockResolvedValue({ ...LIGNE_CANDIDAT_DETAIL, cvPath: null })

    const detail = await detailCandidatureCandidat(5, 91)

    expect(detail?.cvSelectionne).toBe(false)
    expect(detail).not.toHaveProperty('cvPath')
  })
})

// ─── Côté recruteur ──────────────────────────────────────────────────────────

describe('listerCandidaturesRecruteur (test de sécurité central)', () => {
  it('LE where porte offre → entreprise → userId, sans aucun contrôle à part', async () => {
    await listerCandidaturesRecruteur(9)

    expect(candidatureFindMany).toHaveBeenCalledTimes(1)
    expect(candidatureFindFirst).toHaveBeenCalledTimes(0)
    expect(candidatureFindMany.mock.calls[0]?.[0].where).toEqual({
      offre: { entreprise: { userId: 9 } },
    })
    // Le count partage le MÊME where : total et page décrivent le périmètre.
    expect(candidatureCount.mock.calls[0]?.[0].where).toEqual({
      offre: { entreprise: { userId: 9 } },
    })
  })

  it('un compte étranger ne peut être « substitué » : userId toujours en profondeur', async () => {
    await listerCandidaturesRecruteur(77)

    expect(candidatureFindMany.mock.calls[0]?.[0].where).toEqual({
      offre: { entreprise: { userId: 77 } },
    })
  })

  it('offreId et statut s’intersectionnent avec la jointure (jamais ne la remplacent)', async () => {
    await listerCandidaturesRecruteur(9, { offreId: 42, statut: 'entretien' })

    expect(candidatureFindMany.mock.calls[0]?.[0].where).toEqual({
      offre: { entreprise: { userId: 9 } },
      offreId: 42,
      statut: 'entretien',
    })
  })

  it('sans filtre : aucune clause de statut', async () => {
    await listerCandidaturesRecruteur(9)

    const where = candidatureFindMany.mock.calls[0]?.[0].where
    expect(where).not.toHaveProperty('statut')
    expect(where).not.toHaveProperty('offreId')
  })

  it('select de sécurité §2.5 : profil limité à titreProfil + user.name/email', async () => {
    await listerCandidaturesRecruteur(9)

    const select = candidatureFindMany.mock.calls[0]?.[0].select
    expect(select).toEqual(SELECT_LISTE_RECRUTEUR)

    // Aucun champ interdit dans TOUT l'arbre du select de liste.
    const arbre = JSON.stringify(select)
    expect(arbre).not.toContain('phone')
    expect(arbre).not.toContain('resume')
    expect(arbre).not.toContain('cvPath')
    expect(arbre).not.toContain('dateNaissance')
    expect(arbre).not.toContain('genre')
    expect(arbre).toContain('titreProfil')
    expect(JSON.stringify(select?.candidat)).toContain('"user"')

    expect(Object.keys(SELECT_LISTE_RECRUTEUR).sort()).toEqual([
      'candidat',
      'createdAt',
      'id',
      'lettreMotivation',
      'offre',
      'statut',
    ])
  })

  it('DTO de liste : candidat réduit à nom/email/titreProfil, offre à id/titre', async () => {
    candidatureFindMany.mockResolvedValue([LIGNE_RECRUTEUR])
    candidatureCount.mockResolvedValue(1)

    const resultat: ResultatListeCandidatures<CandidatureRecruteur> =
      await listerCandidaturesRecruteur(9)

    expect(resultat.items[0]).toEqual({
      id: 91,
      statut: 'entretien',
      createdAt: new Date('2026-10-01T09:00:00Z'),
      lettreExtrait: 'Je souhaite rejoindre votre equipe.',
      candidat: {
        nom: 'Awa Ngo',
        email: 'awa.ngo@example.com',
        titreProfil: 'Developpeuse back-end',
      },
      offre: { id: 42, titre: 'Developpeur back-end' },
    })
    expect(Object.keys(resultat.items[0]).sort()).toEqual([
      'candidat',
      'createdAt',
      'id',
      'lettreExtrait',
      'offre',
      'statut',
    ])
    expect(resultat.items[0].candidat).not.toHaveProperty('phone')
    expect(resultat.items[0].candidat).not.toHaveProperty('resume')
    expect(resultat.items[0].candidat).not.toHaveProperty('cvPath')
    expect(resultat.items[0].candidat).not.toHaveProperty('user')
  })

  it('UNE seule findMany par page : pas de requête par ligne ni de requête d’ownership', async () => {
    candidatureFindMany.mockResolvedValue([LIGNE_RECRUTEUR])
    candidatureCount.mockResolvedValue(15)

    await listerCandidaturesRecruteur(9)

    expect(candidatureFindMany).toHaveBeenCalledTimes(1)
    expect(candidatureCount).toHaveBeenCalledTimes(1)
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureGroupBy).not.toHaveBeenCalled()
  })
})

describe('pagination des listes', () => {
  it('page 2 → skip = CANDIDATURES_PAR_PAGE, take = CANDIDATURES_PAR_PAGE', async () => {
    candidatureCount.mockResolvedValue(16)

    const resultat = await listerCandidaturesRecruteur(9, { page: 2 })

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.skip).toBe(CANDIDATURES_PAR_PAGE)
    expect(args?.take).toBe(CANDIDATURES_PAR_PAGE)
    expect(resultat).toEqual({ items: [], total: 16, page: 2, pages: 2 })
  })

  it('page 0 → page 1, skip 0 (même bornes côté candidat)', async () => {
    await listerCandidaturesCandidat(5, { page: 0 })

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.skip).toBe(0)
    expect(args?.take).toBe(CANDIDATURES_PAR_PAGE)
  })

  it('page négative → page 1, skip 0', async () => {
    const resultat = await listerCandidaturesCandidat(5, { page: -7 })

    expect(candidatureFindMany.mock.calls[0]?.[0].skip).toBe(0)
    expect(resultat.page).toBe(1)
  })

  it('sans page : défaut 1, skip 0, take 15', async () => {
    await listerCandidaturesRecruteur(9)

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.skip).toBe(0)
    expect(args?.take).toBe(CANDIDATURES_PAR_PAGE)
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
  })
})

describe('listerCandidaturesOffre (possession en même temps que la lecture)', () => {
  it('offre d’une AUTRE entreprise → null, sans aucune requête de liste', async () => {
    offreFindFirst.mockResolvedValue(null)

    const resultat: ResultatListeCandidatures<CandidatureRecruteur> | null =
      await listerCandidaturesOffre(9, 42)

    expect(resultat).toBeNull()
    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindFirst.mock.calls[0]?.[0].where).toEqual({
      id: 42,
      entreprise: { userId: 9 },
    })
    // Un 403 « offre étrangère » révélerait son existence : ici, même
    // forme que pour une offre absente, puisque le mock renvoie null.
    expect(candidatureFindMany).not.toHaveBeenCalled()
    expect(candidatureCount).not.toHaveBeenCalled()
  })

  it('offre du recruteur → liste filtrée, jointure ET offreId dans le where', async () => {
    offreFindFirst.mockResolvedValue({ id: 42 })
    candidatureFindMany.mockResolvedValue([LIGNE_RECRUTEUR])
    candidatureCount.mockResolvedValue(1)

    const resultat = await listerCandidaturesOffre(9, 42, { statut: 'entretien' })

    expect(resultat?.total).toBe(1)
    expect(resultat?.items[0].offre).toEqual({ id: 42, titre: 'Developpeur back-end' })

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.where).toEqual({
      offre: { entreprise: { userId: 9 } },
      offreId: 42,
      statut: 'entretien',
    })
    expect(args?.select).toEqual(SELECT_LISTE_RECRUTEUR)
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
  })

  it('la possession n’exige PAS deletedAt : l’historique survit à l’offre supprimée', async () => {
    offreFindFirst.mockResolvedValue({ id: 42 })
    candidatureFindMany.mockResolvedValue([])
    candidatureCount.mockResolvedValue(0)

    await listerCandidaturesOffre(9, 42)

    const where = offreFindFirst.mock.calls[0]?.[0].where
    expect(where).toEqual({ id: 42, entreprise: { userId: 9 } })
    expect(where).not.toHaveProperty('deletedAt')
  })

  it('un offreId de filtre étranger est ÉCRASÉ par l’offre possédée (revue Vague 1, O5)', async () => {
    // L'appelant (page) pourrait propager un `?offreId=` arbitraire : la
    // possession doit toujours gagner, sinon la liste afficherait les
    // lignes d'une autre offre.
    offreFindFirst.mockResolvedValue({ id: 42 })
    candidatureFindMany.mockResolvedValue([])
    candidatureCount.mockResolvedValue(0)

    await listerCandidaturesOffre(9, 42, { offreId: 999 })

    const where = candidatureFindMany.mock.calls[0]?.[0].where
    expect(where).toEqual({
      offre: { entreprise: { userId: 9 } },
      offreId: 42,
    })
  })
})

describe('detailCandidatureRecruteur (ownership dans la même requête)', () => {
  it('candidature d’un autre compte → null, jointure dans LE where', async () => {
    candidatureFindFirst.mockResolvedValue(null)

    const detail: CandidatureRecruteurDetail | null = await detailCandidatureRecruteur(9, 77)

    expect(detail).toBeNull()
    expect(candidatureFindFirst).toHaveBeenCalledTimes(1)
    expect(candidatureFindFirst.mock.calls[0]?.[0].where).toEqual({
      id: 77,
      offre: { entreprise: { userId: 9 } },
    })
  })

  it('ligne propre → lettre complète, cvSelectionne, offre étendue, candidat §2.5', async () => {
    candidatureFindFirst.mockResolvedValue(LIGNE_RECRUTEUR_DETAIL)

    const detail = await detailCandidatureRecruteur(9, 91)

    expect(detail?.lettreMotivation).toBe('Je souhaite rejoindre votre equipe.')
    expect(detail?.cvSelectionne).toBe(true)
    expect(detail?.candidat).toEqual({
      nom: 'Awa Ngo',
      email: 'awa.ngo@example.com',
      titreProfil: 'Developpeuse back-end',
    })
    expect(detail?.offre).toEqual({
      id: 42,
      titre: 'Developpeur back-end',
      slug: 'developpeur-back-end-42',
      ville: 'Douala',
      typeContrat: 'CDI',
      statut: 'publiee',
      dateExpiration: new Date('2099-12-31T23:00:00Z'),
      deletedAt: null,
    })
    // La clé de fichier ne sort jamais, seule la dérivation booleenne.
    expect(detail).not.toHaveProperty('cvPath')
    expect(Object.keys(detail ?? {}).sort()).toEqual([
      'candidat',
      'createdAt',
      'cvSelectionne',
      'id',
      'lettreExtrait',
      'lettreMotivation',
      'offre',
      'statut',
    ])
    expect(Object.keys(detail?.offre ?? {}).sort()).toEqual([
      'dateExpiration',
      'deletedAt',
      'id',
      'slug',
      'statut',
      'titre',
      'typeContrat',
      'ville',
    ])
  })

  it('select de détail : candidat identique à la liste, aucun champ de profil', async () => {
    await detailCandidatureRecruteur(9, 91)

    const select = candidatureFindFirst.mock.calls[0]?.[0].select
    expect(JSON.stringify(select?.candidat)).not.toContain('phone')
    expect(JSON.stringify(select?.candidat)).not.toContain('resume')
    expect(JSON.stringify(select?.candidat)).not.toContain('cvPath')
    expect(JSON.stringify(select?.candidat)).toContain('titreProfil')
    // `cvPath` n'apparaît ici que comme SOURCE du booléen cvSelectionne :
    // la clé du modèle ne franchit jamais la frontière du DTO (ci-dessus).
    expect(JSON.stringify(select)).not.toContain('noteRecruteur')
  })
})

// ─── Lectures admin (globales — revue Vague 1, C2) ───────────────────────────
//
// Les SEULES fonctions du module sans clause d'appartenance : réservées aux
// pages `/admin/*` qui vérifient le rôle en amont. Le DTO reste la liste
// blanche §2.5 (moindre privilège — l'admin ne voit pas plus qu'un recruteur).

describe('listerCandidaturesAdmin / detailCandidatureAdmin (globales)', () => {
  it('liste SANS clause d’appartenance, mêmes filtres/selects/pagination que le recruteur', async () => {
    candidatureFindMany.mockResolvedValue([LIGNE_RECRUTEUR])
    candidatureCount.mockResolvedValue(1)

    const resultat = await listerCandidaturesAdmin({ statut: 'entretien' })

    expect(resultat?.total).toBe(1)
    expect(resultat?.items[0]).toEqual({
      id: 91,
      statut: 'entretien',
      createdAt: new Date('2026-10-01T09:00:00Z'),
      lettreExtrait: 'Je souhaite rejoindre votre equipe.',
      candidat: {
        nom: 'Awa Ngo',
        email: 'awa.ngo@example.com',
        titreProfil: 'Developpeuse back-end',
      },
      offre: { id: 42, titre: 'Developpeur back-end' },
    })

    const args = candidatureFindMany.mock.calls[0]?.[0]
    expect(args?.where).toEqual({ statut: 'entretien' })
    // Aucune jointure d'appartenance côté admin (lecture globale justifiée).
    expect(args?.where).not.toHaveProperty('offre')
    expect(args?.select).toEqual(SELECT_LISTE_RECRUTEUR)
    expect(args?.skip).toBe(0)
    expect(args?.take).toBe(CANDIDATURES_PAR_PAGE)
  })

  it('détail admin : id seul dans le where, ligne absente → null, DTO blanc', async () => {
    candidatureFindFirst.mockResolvedValue(null)

    const detail = await detailCandidatureAdmin(77)

    expect(detail).toBeNull()
    expect(candidatureFindFirst.mock.calls[0]?.[0].where).toEqual({ id: 77 })

    candidatureFindFirst.mockResolvedValue(LIGNE_RECRUTEUR_DETAIL)
    const ligne = await detailCandidatureAdmin(91)
    expect(ligne?.candidat).toEqual({
      nom: 'Awa Ngo',
      email: 'awa.ngo@example.com',
      titreProfil: 'Developpeuse back-end',
    })
    expect(ligne).not.toHaveProperty('cvPath')
    expect(ligne?.cvSelectionne).toBe(true)
  })
})

// ─── Compteurs ───────────────────────────────────────────────────────────────

describe('compteursCandidaturesRecruteur', () => {
  it('groupBy sur la MÊME jointure d’appartenance, par statut', async () => {
    candidatureGroupBy.mockResolvedValue([
      { statut: 'envoyee', _count: 3 },
      { statut: 'entretien', _count: 2 },
    ])

    const compteurs = await compteursCandidaturesRecruteur(9)

    expect(candidatureGroupBy).toHaveBeenCalledTimes(1)
    const args = candidatureGroupBy.mock.calls[0]?.[0]
    expect(args?.by).toEqual(['statut'])
    expect(args?.where).toEqual({ offre: { entreprise: { userId: 9 } } })
    expect(args?._count).toBe(true)

    expect(compteurs).toEqual({
      envoyee: 3,
      consultee: 0,
      preselectionnee: 0,
      entretien: 2,
      acceptee: 0,
      refusee: 0,
      retiree: 0,
      toutes: 5,
    })
  })

  it('les 7 clés de statut + « toutes » sont TOUJOURS renvoyées (0 par défaut)', async () => {
    const compteurs = await compteursCandidaturesRecruteur(9)

    expect(Object.keys(compteurs).sort()).toEqual([
      'acceptee',
      'consultee',
      'entretien',
      'envoyee',
      'preselectionnee',
      'refusee',
      'retiree',
      'toutes',
    ])
    expect(compteurs.toutes).toBe(0)
    // Aucune autre requête : un count annexe dirait la même chose que la
    // somme des groupes, pour un périmètre strictement identique.
    expect(candidatureCount).not.toHaveBeenCalled()
    expect(candidatureFindMany).not.toHaveBeenCalled()
  })
})
