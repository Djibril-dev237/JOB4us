import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Prisma } from '@prisma/client'

import {
  OFFRES_PAR_PAGE,
  OFFRES_SIMILAIRES_MAX,
  SELECT_OFFRE_DETAIL,
  SELECT_OFFRE_LISTE,
  dateCouranteDouala,
  entrepriseAOffreVisible,
  lireOffrePublique,
  listerCategoriesFiltre,
  listerOffresPubliques,
  listerOffresSimilaires,
  offreVisible,
  slugOffreVisible,
  slugsOffresVisibles,
  type OffreCarte,
  type OffreDetail,
} from './offres-public'

// ─── Tests de la règle de visibilité publique (M5, task 1) ───────────────────
// Matrice approuvée en étape 2 : publiée AND non expirée (jour inclus,
// Africa/Douala) AND recruteur actif. Les tests prouvent que CETTE entrée
// est celle de toutes les lectures publiques (liste, similaires, catégories,
// accès logo), que la liste blanche de champs est verrouillée, et qu'une
// page = 2 requêtes (aucun N+1).
// ---------------------------------------------------------------------------

interface ArgsFindMany {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
  orderBy?: Prisma.OffreOrderByWithRelationInput
  skip?: number
  take?: number
}

interface ArgsCount {
  where?: Prisma.OffreWhereInput
}

interface ArgsFindFirst {
  where?: Prisma.OffreWhereInput
  select?: Prisma.OffreSelect
}

// Le type de retour dépend du `select` appelé (cartes de liste, fiche,
// sitemap) : le mock reste volontairement `unknown` — les garanties se
// lisent sur les ARGS (select/where/orderBy) et sur les types de retour
// des fonctions de la DAL, eux stricts.
const { offreFindMany, offreFindFirst, offreCount, categorieFindMany } = vi.hoisted(() => ({
  offreFindMany: vi.fn<(args: ArgsFindMany) => Promise<unknown>>(),
  offreFindFirst: vi.fn<(args: ArgsFindFirst) => Promise<OffreDetail | null>>(),
  offreCount: vi.fn<(args: ArgsCount) => Promise<number>>(),
  categorieFindMany: vi.fn<
    (args: unknown) => Promise<{ id: number; nom: string }[]>
  >(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offre: { findMany: offreFindMany, findFirst: offreFindFirst, count: offreCount },
    categorie: { findMany: categorieFindMany },
  },
}))

const CARTE: OffreCarte = {
  id: 42,
  titre: 'Developpeur back-end',
  slug: 'developpeur-back-end-42',
  ville: 'Douala',
  pays: 'Cameroun',
  typeContrat: 'CDI',
  niveauExperience: 'junior',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  categorie: { id: 7, nom: 'Informatique' },
  entreprise: { id: 3, nom: 'Test Entreprise', logo: 'logos/test.png' },
}

/** Fiche complète (liste blanche enrichie de la task 5). */
const FICHE: OffreDetail = {
  ...CARTE,
  description: 'Poste en télétravail.\n2 ans d’expérience minimum.',
  dateExpiration: new Date('2026-12-30T23:00:00Z'),
  salaireMin: null,
  salaireMax: null,
  salaireVisible: false,
  entreprise: {
    id: 3,
    nom: 'Test Entreprise',
    logo: 'logos/test.png',
    secteurActivite: 'Informatique',
    ville: 'Douala',
  },
  competences: [{ competence: { nom: 'PHP' } }],
}

// Date figée pour toutes les assertions : mercredi 2026-10-07, 10:00 UTC
// = 11:00 à Douala (UTC+1).
const MAINTENANT = new Date('2026-10-07T10:00:00Z')

beforeEach(() => {
  offreFindMany.mockReset()
  offreFindFirst.mockReset()
  offreCount.mockReset()
  categorieFindMany.mockReset()
  offreFindMany.mockResolvedValue([CARTE])
  offreFindFirst.mockResolvedValue(null)
  offreCount.mockResolvedValue(1)
  categorieFindMany.mockResolvedValue([{ id: 7, nom: 'Informatique' }])
})

describe('dateCouranteDouala', () => {
  it('borne les dates sur le fuseau du pays et pas sur celui du serveur', () => {
    // 22:30Z = 23:30 à Douala : toujours le 2 octobre.
    expect(dateCouranteDouala(new Date('2026-10-02T22:30:00Z'))).toBe(
      '2026-10-02',
    )
    // 23:30Z = 00:30 à Douala : déjà le 3 octobre.
    expect(dateCouranteDouala(new Date('2026-10-02T23:30:00Z'))).toBe(
      '2026-10-03',
    )
    // Fin de journée locale : 22:59Z = 23:59 à Douala (toujours le 7) ;
    // 23:00Z = minuit à Douala → déjà le 8. La bascule est exactement
    // sur le minuit local, pas sur minuit UTC.
    expect(dateCouranteDouala(new Date('2026-10-07T22:59:00Z'))).toBe(
      '2026-10-07',
    )
    expect(dateCouranteDouala(new Date('2026-10-07T23:00:00Z'))).toBe(
      '2026-10-08',
    )
  })
})

describe('offreVisible (prédicat unique)', () => {
  it('exige publication, expiration non passée ET compte recruteur actif', () => {
    expect(offreVisible(MAINTENANT)).toEqual({
      isActive: true,
      // Minuit civil à Douala (UTC+1) = 23:00Z la veille : le jour
      // d'expiration est inclus jusqu'à la fin de la journée locale.
      dateExpiration: { gte: new Date('2026-10-06T23:00:00.000Z') },
      entreprise: { user: { isActive: true } },
    })
  })

  it("omet toute valeur qui permettrait de distinguer les 404", () => {
    // Pas de clause id : invisible et inexistant sont indistinguables.
    expect(offreVisible(MAINTENANT)).not.toHaveProperty('id')
  })
})

describe('listerOffresPubliques', () => {
  it('applique le prédicat unique comme première condition', async () => {
    await listerOffresPubliques({}, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([offreVisible(MAINTENANT)])
  })

  it('borne les résultats à la liste blanche de champs', async () => {
    await listerOffresPubliques({}, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.select).toEqual(SELECT_OFFRE_LISTE)
    expect(Object.keys(SELECT_OFFRE_LISTE).sort()).toEqual([
      'categorie',
      'createdAt',
      'entreprise',
      'id',
      'niveauExperience',
      'pays',
      'slug',
      'titre',
      'typeContrat',
      'ville',
    ])
  })

  it('trient par publication décroissante et pagine 10 par 10', async () => {
    await listerOffresPubliques({}, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
    expect(args?.skip).toBe(0)
    expect(args?.take).toBe(OFFRES_PAR_PAGE)
  })

  it("exécute 2 requêtes par page (aucun N+1)", async () => {
    await listerOffresPubliques({ page: 1 }, MAINTENANT)

    expect(offreCount).toHaveBeenCalledTimes(1)
    expect(offreFindMany).toHaveBeenCalledTimes(1)
  })

  it('ramène une page hors bornes à la dernière page réelle', async () => {
    offreCount.mockResolvedValue(25)

    const resultat = await listerOffresPubliques({ page: 99 }, MAINTENANT)

    expect(resultat.page).toBe(3)
    expect(resultat.totalPages).toBe(3)
    expect(resultat.total).toBe(25)
    expect(offreFindMany.mock.calls[0]?.[0].skip).toBe(2 * OFFRES_PAR_PAGE)
  })

  it('n’active aucun filtre quand aucun paramètre n’est fourni', async () => {
    await listerOffresPubliques({}, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toHaveLength(1)
  })

  it('recherche q dans titre OU description, en sous-chaîne', async () => {
    await listerOffresPubliques({ q: 'php' }, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([
      offreVisible(MAINTENANT),
      {
        OR: [
          { titre: { contains: 'php' } },
          { description: { contains: 'php' } },
        ],
      },
    ])
  })

  it('applique ville en sous-chaîne et les filtres exacts', async () => {
    await listerOffresPubliques(
      {
        ville: 'doua',
        categorie: 7,
        typeContrat: 'CDI',
        niveau: 'senior',
      },
      MAINTENANT,
    )

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([
      offreVisible(MAINTENANT),
      { ville: { contains: 'doua' } },
      { categorieId: 7 },
      { typeContrat: 'CDI' },
      { niveauExperience: 'senior' },
    ])
  })
})

describe('listerOffresSimilaires', () => {
  it('réutilise le prédicat unique, limite à 4 et exclut l’offre courante', async () => {
    await listerOffresSimilaires(7, 42, MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([
      offreVisible(MAINTENANT),
      { categorieId: 7 },
      { id: { not: 42 } },
    ])
    expect(args?.take).toBe(OFFRES_SIMILAIRES_MAX)
    expect(args?.select).toEqual(SELECT_OFFRE_LISTE)
  })
})

describe('lireOffrePublique (fiche par slug)', () => {
  it('rejette tout slug non conforme AVANT toute requête base', async () => {
    expect(await lireOffrePublique('42', MAINTENANT)).toBeNull()
    expect(await lireOffrePublique('Developpeur-1', MAINTENANT)).toBeNull()
    expect(await lireOffrePublique('developpeur-php', MAINTENANT)).toBeNull()
    expect(await lireOffrePublique('developpeur--php-42', MAINTENANT)).toBeNull()

    expect(offreFindFirst).not.toHaveBeenCalled()
  })

  it('slug valide sans offre → null, avec le prédicat unique dans le WHERE', async () => {
    offreFindFirst.mockResolvedValue(null)

    expect(await lireOffrePublique('inexistant-99', MAINTENANT)).toBeNull()

    // Brouillon, expirée, recruteur suspendu ou slug vide d'une offre
    // masquée : findFirst tombe sur null → notFound() côté page, 404
    // strictement identique à une offre qui n'existe pas.
    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([{ slug: 'inexistant-99' }, offreVisible(MAINTENANT)])
    expect(args?.select).toEqual(SELECT_OFFRE_DETAIL)
  })

  it('renvoie la fiche complète avec la liste blanche enrichie', async () => {
    offreFindFirst.mockResolvedValue(FICHE)

    const fiche = await lireOffrePublique('developpeur-back-end-42', MAINTENANT)

    expect(fiche).toEqual(FICHE)
    expect(fiche?.competences).toEqual([{ competence: { nom: 'PHP' } }])
    expect(fiche?.description).toContain('télétravail')
  })
})

describe('slugOffreVisible (contrôle pré-streaming du proxy)', () => {
  it('slug non conforme → false SANS requête base', async () => {
    // URL legacy /offres/42, casse interdite, slug vide : le regex de
    // src/lib/slug.ts tranche avant toute requête — un scanner ne coûte
    // rien (prescription « keep proxy checks fast » de la doc Next).
    expect(await slugOffreVisible('42', MAINTENANT)).toBe(false)
    expect(await slugOffreVisible('Developpeur-1', MAINTENANT)).toBe(false)
    expect(await slugOffreVisible('developpeur--php-42', MAINTENANT)).toBe(false)
    expect(await slugOffreVisible('', MAINTENANT)).toBe(false)

    expect(offreFindFirst).not.toHaveBeenCalled()
  })

  it('slug sans offre visible → false, prédicat unique et select id seul', async () => {
    // Brouillon, expirée, recruteur suspendu ou simple absence : le
    // proxy reçoit exactement la même réponse false → rewrite 404,
    // aucun distinguo entre les causes (anti-fuite identique au 404
    // de la page).
    expect(await slugOffreVisible('developpeur-php-5', MAINTENANT)).toBe(false)

    const args = offreFindFirst.mock.calls[0]?.[0]
    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(args?.where?.AND).toEqual([
      { slug: 'developpeur-php-5' },
      offreVisible(MAINTENANT),
    ])
    expect(args?.select).toEqual({ id: true })
  })

  it('offre visible → true (le proxy laisse le rendu se faire)', async () => {
    offreFindFirst.mockResolvedValue(FICHE)

    expect(await slugOffreVisible('developpeur-back-end-42', MAINTENANT)).toBe(
      true,
    )
  })
})

describe('slugsOffresVisibles (sitemap)', () => {
  it('publie sous le prédicat unique, sélectif slug + updatedAt seulement', async () => {
    const miseAJour = new Date('2026-10-02T10:00:00Z')
    offreFindMany.mockResolvedValue([
      { slug: 'developpeur-back-end-1', updatedAt: miseAJour },
    ])

    const slugs = await slugsOffresVisibles(MAINTENANT)

    const args = offreFindMany.mock.calls[0]?.[0]
    expect(args?.where?.AND).toEqual([
      offreVisible(MAINTENANT),
      { slug: { not: null } },
    ])
    expect(args?.select).toEqual({ slug: true, updatedAt: true })
    expect(args?.orderBy).toEqual({ createdAt: 'desc' })
    expect(slugs).toEqual([
      { slug: 'developpeur-back-end-1', updatedAt: miseAJour },
    ])
  })

  it('une offre invisible ne produit aucune entrée de sitemap', async () => {
    // Brouillon/expirée : findMany filtré par offreVisible() ne renvoie
    // rien → sitemap sans cette URL, conformément au critère « 404 …
    // ET sitemap ».
    offreFindMany.mockResolvedValue([])

    expect(await slugsOffresVisibles(MAINTENANT)).toEqual([])
  })
})

describe('comptage de requêtes par page (task 7)', () => {
  it('page liste = 3 requêtes planifiées, jamais une par offre', async () => {
    await listerOffresPubliques({ page: 1 })
    await listerCategoriesFiltre()

    expect(offreCount).toHaveBeenCalledTimes(1)
    expect(offreFindMany).toHaveBeenCalledTimes(1)
    expect(categorieFindMany).toHaveBeenCalledTimes(1)
    expect(offreFindFirst).not.toHaveBeenCalled()
  })

  it('page fiche = 2 requêtes (fiche + similaires), zéro par ligne affichée', async () => {
    offreFindFirst.mockResolvedValue(FICHE)

    const offre = await lireOffrePublique('developpeur-back-end-42', MAINTENANT)
    const similaires =
      offre !== null
        ? await listerOffresSimilaires(offre.categorie.id, offre.id, MAINTENANT)
        : []

    expect(similaires).toBeDefined()
    expect(offreFindFirst).toHaveBeenCalledTimes(1)
    expect(offreFindMany).toHaveBeenCalledTimes(1)
    expect(offreCount).not.toHaveBeenCalled()
    expect(categorieFindMany).not.toHaveBeenCalled()
  })
})

describe('listerCategoriesFiltre', () => {
  it('renvoie toutes les catégories en alpha, sans autre champ', async () => {
    const categories = await listerCategoriesFiltre()

    expect(categories).toEqual([{ id: 7, nom: 'Informatique' }])
    expect(categorieFindMany.mock.calls[0]?.[0]).toEqual({
      orderBy: { nom: 'asc' },
      select: { id: true, nom: true },
    })
  })
})

describe('entrepriseAOffreVisible (option B logos)', () => {
  it('ouvre l’accès logo seulement si l’entreprise a une offre visible', async () => {
    offreCount.mockResolvedValue(1)
    expect(await entrepriseAOffreVisible(1, MAINTENANT)).toBe(true)

    expect(offreCount.mock.calls[0]?.[0].where).toEqual({
      AND: [offreVisible(MAINTENANT), { entrepriseId: 1 }],
    })

    offreCount.mockReset()
    offreCount.mockResolvedValue(0)
    expect(await entrepriseAOffreVisible(2, MAINTENANT)).toBe(false)
  })
})

describe('listes blanches (verrou anti-fuite)', () => {
  it('la carte n’expose aucune donnée privée', () => {
    const clefs = Object.keys(SELECT_OFFRE_LISTE)
    for (const interdite of [
      'description',
      'vues',
      'dateExpiration',
      'emailContact',
      'competences',
      'candidatures',
    ]) {
      expect(clefs).not.toContain(interdite)
    }
    // Entreprise : identité d'affichage + clé d'appel du logo, rien d'autre.
    expect(SELECT_OFFRE_LISTE.entreprise.select).toEqual({
      id: true,
      nom: true,
      logo: true,
    })
  })

  it('la fiche n’expose ni coordonnées ni compte d’entreprise', () => {
    expect(SELECT_OFFRE_DETAIL.entreprise.select).toEqual({
      id: true,
      nom: true,
      logo: true,
      secteurActivite: true,
      ville: true,
    })
    expect(Object.keys(SELECT_OFFRE_DETAIL)).not.toEqual(
      expect.arrayContaining([
        'emailContact',
        'telephone',
        'adresse',
        'siteWeb',
        'vues',
      ]),
    )
    // Jamais de relation vers User : le compte du recruteur reste privé.
    expect(SELECT_OFFRE_DETAIL.entreprise.select).not.toHaveProperty('user')
  })
})
