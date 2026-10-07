import { NiveauExperience, TypeContrat } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  NIVEAU_EXPERIENCE_LABELS,
  NIVEAU_EXPERIENCE_VALUES,
  OffreFormSchema,
  OffresQuerySchema,
  TYPE_CONTRAT_LABELS,
  TYPE_CONTRAT_VALUES,
} from './definitions'

// ─── Tests du schéma d’URL /offres (M5, task 3) ──────────────────────────────
// Verrouillent : noms de paramètres legacy, coercitions, « invalide = ignoré
// (jamais d’erreur) », bornes de longueur, strip des clés inconnues, et
// l’égalité des tuples de valeurs avec les enums Prisma (anti-divergence).
// ---------------------------------------------------------------------------

describe('OffresQuerySchema — URL complète', () => {
  it('lit les 6 paramètres legacy avec coercitions numériques', () => {
    const resultat = OffresQuerySchema.safeParse({
      q: 'développeur',
      ville: 'Douala',
      categorie: '3',
      type_contrat: 'stage',
      niveau: 'junior',
      page: '2',
    })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      q: 'développeur',
      ville: 'Douala',
      categorie: 3,
      type_contrat: 'stage',
      niveau: 'junior',
      page: 2,
    })
  })

  it('ignore les clés inconnues (utm_source, fbclid…)', () => {
    const resultat = OffresQuerySchema.safeParse({
      q: 'dev',
      utm_source: 'newsletter',
      fbclid: '123',
    })

    expect(resultat.success).toBe(true)
    expect(resultat.data).toEqual({
      q: 'dev',
      ville: undefined,
      categorie: undefined,
      type_contrat: undefined,
      niveau: undefined,
      page: undefined,
    })
  })
})

describe('OffresQuerySchema — invalidité = paramètre ignoré', () => {
  it('une racine non objet fait échouer le parse (repli error.tsx)', () => {
    expect(() => OffresQuerySchema.parse(null)).toThrow()
    expect(() => OffresQuerySchema.parse('page=2')).toThrow()
  })

  it('vide ou en blanc → champ ignoré (trim AVANT min)', () => {
    const resultat = OffresQuerySchema.parse({ q: '   ', ville: '' })

    expect(resultat.q).toBeUndefined()
    expect(resultat.ville).toBeUndefined()
  })

  it('applique le trim aux valeurs exploitables', () => {
    expect(OffresQuerySchema.parse({ q: '  back-end  ' }).q).toBe('back-end')
    expect(OffresQuerySchema.parse({ ville: ' Douala ' }).ville).toBe('Douala')
  })

  it('valeurs hors enum → ignorées, jamais une erreur', () => {
    const resultat = OffresQuerySchema.parse({
      type_contrat: 'CDI3',
      niveau: 'rockstar',
      categorie: '999abc',
    })

    expect(resultat.type_contrat).toBeUndefined()
    expect(resultat.niveau).toBeUndefined()
    expect(resultat.categorie).toBeUndefined()
  })

  it('page invalide → 1 (clamp), page absente → undefined, page valide → conservée', () => {
    expect(OffresQuerySchema.parse({ page: '-4' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '0' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '2.5' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: 'abc' }).page).toBe(1)
    expect(OffresQuerySchema.parse({ page: '12' }).page).toBe(12)
    expect(OffresQuerySchema.parse({}).page).toBeUndefined()
  })

  it('paramètre répété (string[]) → ignoré sauf coercion mono-élément', () => {
    const resultat = OffresQuerySchema.parse({
      q: ['a', 'b'],
      categorie: ['1', '2'],
      page: ['3', '4'],
    })

    expect(resultat.q).toBeUndefined()
    expect(resultat.categorie).toBeUndefined()
    expect(resultat.page).toBe(1)
  })
})

describe('OffresQuerySchema — bornes defensives', () => {
  it('q au-delà de 200 caractères et ville au-delà de 100 → ignorés', () => {
    const resultat = OffresQuerySchema.parse({
      q: 'a'.repeat(201),
      ville: 'b'.repeat(101),
    })

    expect(resultat.q).toBeUndefined()
    expect(resultat.ville).toBeUndefined()
  })

  it('q à 200 et ville à 100 caractères → acceptés', () => {
    expect(OffresQuerySchema.parse({ q: 'a'.repeat(200) }).q).toHaveLength(200)
    expect(OffresQuerySchema.parse({ ville: 'b'.repeat(100) }).ville).toHaveLength(100)
  })
})

describe('valeurs de filtre vs enums Prisma', () => {
  it('TYPE_CONTRAT_VALUES couvre exactement l’enum Prisma', () => {
    expect([...TYPE_CONTRAT_VALUES].sort()).toEqual(Object.values(TypeContrat).sort())
  })

  it('NIVEAU_EXPERIENCE_VALUES couvre exactement l’enum Prisma', () => {
    expect([...NIVEAU_EXPERIENCE_VALUES].sort()).toEqual(
      Object.values(NiveauExperience).sort(),
    )
  })

  it('chaque valeur possède un libellé affichable', () => {
    expect(Object.keys(TYPE_CONTRAT_LABELS).sort()).toEqual(Object.values(TypeContrat).sort())
    expect(Object.keys(NIVEAU_EXPERIENCE_LABELS).sort()).toEqual(
      Object.values(NiveauExperience).sort(),
    )
    for (const libelle of [...Object.values(TYPE_CONTRAT_LABELS), ...Object.values(NIVEAU_EXPERIENCE_LABELS)]) {
      expect(libelle.trim()).not.toBe('')
      expect(libelle).not.toContain('_')
    }
  })

  it('les options d’URL correspondent aux valeurs du schema', () => {
    // Le schema et les tuples servent aux selects ET à la réécriture des
    // liens : diverger = lien de pagination qui filtre autrement que l’écran.
    for (const valeur of TYPE_CONTRAT_VALUES) {
      expect(OffresQuerySchema.parse({ type_contrat: valeur }).type_contrat).toBe(valeur)
    }
    for (const valeur of NIVEAU_EXPERIENCE_VALUES) {
      expect(OffresQuerySchema.parse({ niveau: valeur }).niveau).toBe(valeur)
    }
  })
})

// ─── Tests du schéma d’offre recruteur (M6) ──────────────────────────────────
// Verrouillent le contrat d’écran : liste blanche .strip() (anti
// mass-assign), intention .catch (jamais de publication par accident), tube
// texteSansBalises → trim → bornes (on mesure APRÈS nettoyage), salaire vide
// → null et JAMAIS 0, calendrier réel SANS comparaison à aujourd’hui (D3 est
// une règle de PUBLICATION, vérifiée à la transition de statut, pas ici), et
// la forme de sortie typée d’OffreFormData.
// ---------------------------------------------------------------------------

/** Payload minimal VALIDÉ par le schéma : chaque test ne modifie qu’UN champ,
 *  pour que l’échec observé soit toujours celui qu’on cherchait. Il reproduit
 *  la construction du repo (formDataString sur clés explicites) : les trois
 *  champs bâtis sur `z.unknown()` y sont PRÉSENTS à « », valeur qu’un
 *  navigateur envoie pour un input number vide et que formDataString renvoie
 *  pour une clé absente. `date_expiration` reste une date de calendrier
 *  réelle, mais aucune comparaison avec aujourd’hui n’est faite ici — voir
 *  le bloc date_expiration plus bas. */
const PAYLOAD_OFFRE_VALIDE = {
  titre: 'Développeur Web Full Stack',
  categorie_id: '3',
  description: 'Mission à Douala au sein d’une équipe produit.',
  type_contrat: 'CDI',
  niveau_experience: 'junior',
  ville: 'Douala',
  date_expiration: '2027-06-30',
  salaire_min: '',
  salaire_max: '',
  salaire_visible: '',
}

/** Recolle un champ modifié sur le payload de base. */
function payloadOffre(champs: Record<string, unknown>): Record<string, unknown> {
  return { ...PAYLOAD_OFFRE_VALIDE, ...champs }
}

/** Clone du payload SANS les clés indiquées : le parseur d’objets (« cle in
 *  objet ») distingue une clé réellement omise d’une clé présente à
 *  `undefined`, et c’est précisément ce que les cas d’absence vont opposer. */
function payloadSans(payload: Record<string, unknown>, ...clesOupees: string[]) {
  return Object.fromEntries(
    Object.entries(payload).filter(([cle]) => !clesOupees.includes(cle)),
  )
}

/** Parse censé ÉCHOUER : renvoie les issues. Évite de resserrer à la main le
 *  type étroit SafeParseSuccess/SafeParseError dans chacun des tests. */
function issuesRefus(payload: unknown) {
  const resultat = OffreFormSchema.safeParse(payload)
  if (resultat.success) {
    throw new Error('Le payload aurait dû être refusé par OffreFormSchema.')
  }
  return resultat.error.issues
}

describe('OffreFormSchema — liste blanche anti mass-assignment', () => {
  it('écarte statut, entrepriseId, id, slug, deletedAt et vues injectés', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({
        statut: 'publiee',
        entrepriseId: 99,
        id: 5,
        slug: 'developpeur-web-full-stack',
        deletedAt: '2026-01-01',
        vues: 42,
      }),
    )

    // Le parse doit réussir (les clés inconnues ne sont pas validées) ET les
    // retirer : sinon un payload fabriqué ferait basculer le statut de
    // l’offre lors d’une écriture par étalage du résultat.
    for (const cle of ['statut', 'entrepriseId', 'id', 'slug', 'deletedAt', 'vues']) {
      expect(donnees).not.toHaveProperty(cle)
    }
  })

  it('accepte un payload de formulaire valide seul', () => {
    const donnees = OffreFormSchema.parse(PAYLOAD_OFFRE_VALIDE)

    expect(donnees.titre).toBe('Développeur Web Full Stack')
    expect(donnees.ville).toBe('Douala')
  })
})

describe('OffreFormSchema — intention', () => {
  it('clé absente → enregistrer, le niveau de privilège le plus bas', () => {
    expect(OffreFormSchema.parse(PAYLOAD_OFFRE_VALIDE).intention).toBe('enregistrer')
  })

  it('publier → publier', () => {
    expect(OffreFormSchema.parse(payloadOffre({ intention: 'publier' })).intention).toBe(
      'publier',
    )
  })

  it('casse différente, chaîne vide ou valeur inconnue → enregistrer (.catch)', () => {
    // .catch absorbe tout : une intention corrompue ne doit JAMAIS pouvoir
    // déclencher une publication, seulement l’action la moins privilégiée.
    for (const intention of ['Publier', '', 'oui']) {
      expect(OffreFormSchema.parse(payloadOffre({ intention })).intention).toBe('enregistrer')
    }
  })
})

describe('OffreFormSchema — competences', () => {
  it('clé absente → [] (détachement complet, comme le has() legacy)', () => {
    expect(OffreFormSchema.parse(PAYLOAD_OFFRE_VALIDE).competences).toEqual([])
  })

  it('coerce les chaînes FormData et déduplique les doublons', () => {
    const donnees = OffreFormSchema.parse(payloadOffre({ competences: ['3', '1', '3'] }))

    // L’ordre du Set suit l’ordre d’entrée ; seul le JEU d’identifiants
    // compte pour la table pivot, on compare donc par ordre croissant.
    expect([...donnees.competences].sort((a, b) => a - b)).toEqual([1, 3])
    expect(donnees.competences).toHaveLength(2)
  })

  it('plafond exact : 50 entrées acceptées, 51 refusées', () => {
    const cinquante = Array.from({ length: 50 }, (_element, index) => String(index + 1))
    expect(OffreFormSchema.parse(payloadOffre({ competences: cinquante })).competences).toHaveLength(50)

    const cinquanteEtUne = Array.from({ length: 51 }, (_element, index) => String(index + 1))
    expect(issuesRefus(payloadOffre({ competences: cinquanteEtUne }))).toEqual([
      expect.objectContaining({
        path: ['competences'],
        message: 'Trop de compétences sélectionnées (maximum 50).',
      }),
    ])
  })

  it('identifiant 0 → refusé (doit être positif)', () => {
    expect(issuesRefus(payloadOffre({ competences: [0] }))).toEqual([
      expect.objectContaining({
        path: ['competences', 0],
        message: 'Compétence : identifiant positif attendu.',
      }),
    ])
  })

  it('identifiant 1.5 → refusé (doit être entier)', () => {
    expect(issuesRefus(payloadOffre({ competences: [1.5] }))).toEqual([
      expect.objectContaining({
        path: ['competences', 0],
        message: 'Compétence : identifiant entier attendu.',
      }),
    ])
  })

  it('identifiant « abc » → refusé (doit être numérique)', () => {
    expect(issuesRefus(payloadOffre({ competences: ['abc'] }))).toEqual([
      expect.objectContaining({
        path: ['competences', 0],
        message: 'Compétence : identifiant numérique attendu.',
      }),
    ])
  })
})

describe('OffreFormSchema — pays', () => {
  it('clé absente → Cameroun (défaut du blade et de la colonne Prisma)', () => {
    expect(OffreFormSchema.parse(PAYLOAD_OFFRE_VALIDE).pays).toBe('Cameroun')
  })

  it('chaîne vide → Cameroun (le défaut ne sert QUE si le champ est vide)', () => {
    expect(OffreFormSchema.parse(payloadOffre({ pays: '' })).pays).toBe('Cameroun')
  })

  it('retire les balises avant de mesurer', () => {
    expect(OffreFormSchema.parse(payloadOffre({ pays: '<b>Cameroun</b>' })).pays).toBe('Cameroun')
  })

  it('plus de 100 caractères → refusé par la borne de la colonne', () => {
    expect(issuesRefus(payloadOffre({ pays: 'a'.repeat(101) }))).toEqual([
      expect.objectContaining({
        path: ['pays'],
        message: 'Le pays ne doit pas dépasser 100 caractères.',
      }),
    ])
  })
})

describe('OffreFormSchema — date_expiration', () => {
  it('jour de calendrier inexistant (30 février) → refusé', () => {
    expect(issuesRefus(payloadOffre({ date_expiration: '2026-02-30' }))).toEqual([
      expect.objectContaining({
        path: ['date_expiration'],
        message: 'Date d’expiration inexistante : ce jour n’existe pas dans le calendrier.',
      }),
    ])
  })

  it('mois hors calendrier (13) → refusé', () => {
    expect(issuesRefus(payloadOffre({ date_expiration: '2026-13-01' }))).toEqual([
      expect.objectContaining({
        path: ['date_expiration'],
        message: 'Date d’expiration inexistante : ce jour n’existe pas dans le calendrier.',
      }),
    ])
  })

  it('jour bissextile réel (29 février 2024) → accepté', () => {
    expect(OffreFormSchema.parse(payloadOffre({ date_expiration: '2024-02-29' })).date_expiration).toBe(
      '2024-02-29',
    )
  })

  it('format non AAAA-MM-JJ → refusé', () => {
    // Les checks d’un même champ ne s’arrêtent pas au premier échec : la
    // regex ET le contrôle calendrier tombent sur « 01/01/2027 ». On exige
    // le message de format, celui qui décrit la vraie cause.
    expect(issuesRefus(payloadOffre({ date_expiration: '01/01/2027' }))).toContainEqual(
      expect.objectContaining({
        path: ['date_expiration'],
        message: 'Date d’expiration invalide : format attendu AAAA-MM-JJ.',
      }),
    )
  })

  it('accepte une date passée : aucune comparaison à aujourd’hui dans le formulaire (règle D3 = publication)', () => {
    // Intention lisible : enregistrer un brouillon avec une date déjà passée
    // reste légitime. Date ≥ aujourd’hui à Douala se vérifie à la transition
    // de statut côté action serveur, jamais ici.
    expect(OffreFormSchema.parse(payloadOffre({ date_expiration: '2020-01-01' })).date_expiration).toBe(
      '2020-01-01',
    )
  })
})

describe('OffreFormSchema — salaires', () => {
  it('clés réellement omises du payload → null, jamais 0', () => {
    const donnees = OffreFormSchema.parse(
      payloadSans(PAYLOAD_OFFRE_VALIDE, 'salaire_min', 'salaire_max'),
    )

    expect(donnees.salaire_min).toBeNull()
    expect(donnees.salaire_max).toBeNull()
  })

  it('clés présentes à undefined → null, jamais 0', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({ salaire_min: undefined, salaire_max: undefined }),
    )

    expect(donnees.salaire_min).toBeNull()
    expect(donnees.salaire_max).toBeNull()
  })

  it('chaînes vides → null, jamais 0 (une coercion aveugle écrirait « 0 »)', () => {
    const donnees = OffreFormSchema.parse(payloadOffre({ salaire_min: '', salaire_max: '' }))

    expect(donnees.salaire_min).toBeNull()
    expect(donnees.salaire_max).toBeNull()
  })

  it('chaînes numériques FormData → nombres', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({ salaire_min: '150000', salaire_max: '300000' }),
    )

    expect(donnees.salaire_min).toBe(150000)
    expect(donnees.salaire_max).toBe(300000)
  })

  it('valeur négative → refusée avec le libellé du champ concerné', () => {
    expect(issuesRefus(payloadOffre({ salaire_min: '-1' }))).toEqual([
      expect.objectContaining({
        path: ['salaire_min'],
        message: 'Salaire minimum (FCFA) ne peut pas être négatif.',
      }),
    ])
    expect(issuesRefus(payloadOffre({ salaire_max: '-1' }))).toEqual([
      expect.objectContaining({
        path: ['salaire_max'],
        message: 'Salaire maximum (FCFA) ne peut pas être négatif.',
      }),
    ])
  })

  it('borne haute Decimal(10,2) → acceptée à 99 999 999,99, refusée au-delà', () => {
    // Colonne `Decimal(10,2)` = 8 chiffres entiers + 2 décimaux : au-delà,
    // MySQL lèverait une erreur 1264 à l’écriture (500) au lieu d’une
    // erreur de champ — la borne appartient au schéma comme toutes les
    // autres, pas seulement à la couche base.
    const auLimite = OffreFormSchema.parse(
      payloadOffre({ salaire_min: '99999999.99', salaire_max: '99999999.99' }),
    )
    expect(auLimite.salaire_min).toBe(99_999_999.99)
    expect(auLimite.salaire_max).toBe(99_999_999.99)

    expect(issuesRefus(payloadOffre({ salaire_min: '100000000' }))).toEqual([
      expect.objectContaining({
        path: ['salaire_min'],
        message: 'Salaire minimum (FCFA) ne peut pas dépasser 99 999 999,99.',
      }),
    ])
    expect(issuesRefus(payloadOffre({ salaire_max: '99999999999999' }))).toEqual([
      expect.objectContaining({
        path: ['salaire_max'],
        message: 'Salaire maximum (FCFA) ne peut pas dépasser 99 999 999,99.',
      }),
    ])
  })

  it('valeur non numérique → refusée', () => {
    expect(issuesRefus(payloadOffre({ salaire_min: 'abc' }))).toEqual([
      expect.objectContaining({
        path: ['salaire_min'],
        message: 'Salaire minimum (FCFA) : un nombre est attendu.',
      }),
    ])
  })

  it('minimum supérieur au maximum → refusé par superRefine sur salaire_min', () => {
    expect(
      issuesRefus(payloadOffre({ salaire_min: '500000', salaire_max: '300000' })),
    ).toEqual([
      expect.objectContaining({
        path: ['salaire_min'],
        message:
          'Le Salaire minimum (FCFA) doit être inférieur ou égal au Salaire maximum (FCFA).',
      }),
    ])
  })

  it('minimum seul sans maximum → accepté (la borne ne s’applique que si les deux sont renseignés)', () => {
    const donnees = OffreFormSchema.parse(payloadOffre({ salaire_min: '200000' }))

    expect(donnees.salaire_min).toBe(200000)
    expect(donnees.salaire_max).toBeNull()
  })
})

describe('OffreFormSchema — salaire_visible', () => {
  it('clé réellement omise du payload → false (case non cochée lue par Object.fromEntries)', () => {
    expect(
      OffreFormSchema.parse(payloadSans(PAYLOAD_OFFRE_VALIDE, 'salaire_visible')).salaire_visible,
    ).toBe(false)
  })

  it('clé présente à undefined → false', () => {
    expect(
      OffreFormSchema.parse(payloadOffre({ salaire_visible: undefined })).salaire_visible,
    ).toBe(false)
  })

  it('null (formData.get sur clé absente) → false', () => {
    expect(OffreFormSchema.parse(payloadOffre({ salaire_visible: null })).salaire_visible).toBe(
      false,
    )
  })

  it('chaîne vide (convention formDataString) → false, jamais true', () => {
    expect(OffreFormSchema.parse(payloadOffre({ salaire_visible: '' })).salaire_visible).toBe(
      false,
    )
  })

  it('« on », la seule valeur émise par le navigateur → true', () => {
    expect(OffreFormSchema.parse(payloadOffre({ salaire_visible: 'on' })).salaire_visible).toBe(
      true,
    )
  })
})

describe('OffreFormSchema — titre', () => {
  it('retire les balises et garde le texte restant conforme', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({ titre: '<script>alert(1)</script>Développeur' }),
    )

    expect(donnees.titre).not.toContain('<')
    expect(donnees.titre).not.toContain('>')
    expect(donnees.titre).toContain('Développeur')
  })

  it('réduit à « <b></b> » → échoue sur le min, mesuré APRÈS nettoyage', () => {
    expect(issuesRefus(payloadOffre({ titre: '<b></b>' }))).toEqual([
      expect.objectContaining({
        path: ['titre'],
        message: 'Le titre du poste doit contenir au moins 3 caractères.',
      }),
    ])
  })

  it('« AB » entouré d’espaces → trim puis échec du min 3', () => {
    expect(issuesRefus(payloadOffre({ titre: ' AB ' }))).toEqual([
      expect.objectContaining({
        path: ['titre'],
        message: 'Le titre du poste doit contenir au moins 3 caractères.',
      }),
    ])
  })

  it('201 caractères → refusé par le max 200', () => {
    expect(issuesRefus(payloadOffre({ titre: 'a'.repeat(201) }))).toEqual([
      expect.objectContaining({
        path: ['titre'],
        message: 'Le titre du poste ne doit pas dépasser 200 caractères.',
      }),
    ])
  })

  it('bornes exactes : 3 et 200 caractères acceptés', () => {
    expect(OffreFormSchema.parse(payloadOffre({ titre: 'Dev' })).titre).toBe('Dev')
    expect(OffreFormSchema.parse(payloadOffre({ titre: 'a'.repeat(200) })).titre).toHaveLength(200)
  })

  it('clé absente → refusée (champ requis du blade)', () => {
    expect(issuesRefus(payloadSans(PAYLOAD_OFFRE_VALIDE, 'titre'))).toEqual([
      expect.objectContaining({ path: ['titre'], message: 'Titre du poste requis.' }),
    ])
  })
})

describe('OffreFormSchema — description', () => {
  it('clé absente → refusée (champ requis du blade)', () => {
    expect(issuesRefus(payloadSans(PAYLOAD_OFFRE_VALIDE, 'description'))).toEqual([
      expect.objectContaining({
        path: ['description'],
        message: 'Description du poste requise.',
      }),
    ])
  })

  it('chaîne vide après nettoyage → refusée', () => {
    expect(issuesRefus(payloadOffre({ description: '   ' }))).toEqual([
      expect.objectContaining({
        path: ['description'],
        message: 'La description du poste est requise.',
      }),
    ])
  })

  it('retire les balises du texte', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({ description: '<p>Décrivez le poste.</p>' }),
    )

    expect(donnees.description).toBe('Décrivez le poste.')
  })

  it('10 001 caractères → refusée par le max 10 000', () => {
    expect(issuesRefus(payloadOffre({ description: 'a'.repeat(10_001) }))).toEqual([
      expect.objectContaining({
        path: ['description'],
        message: 'La description du poste ne doit pas dépasser 10 000 caractères.',
      }),
    ])
  })

  it('10 000 caractères → acceptée (borne exacte)', () => {
    expect(
      OffreFormSchema.parse(payloadOffre({ description: 'a'.repeat(10_000) })).description,
    ).toHaveLength(10_000)
  })
})

describe('OffreFormSchema — categorie_id', () => {
  it('option vide « » → coercion en 0 → refusée par le min 1', () => {
    expect(issuesRefus(payloadOffre({ categorie_id: '' }))).toEqual([
      expect.objectContaining({
        path: ['categorie_id'],
        message: 'Catégorie requise : choisissez une catégorie dans la liste.',
      }),
    ])
  })

  it('identifiant en chaîne FormData → nombre', () => {
    expect(OffreFormSchema.parse(payloadOffre({ categorie_id: '5' })).categorie_id).toBe(5)
  })

  it('identifiant décimal → refusé (doit être entier)', () => {
    expect(issuesRefus(payloadOffre({ categorie_id: 1.5 }))).toEqual([
      expect.objectContaining({
        path: ['categorie_id'],
        message: 'Catégorie : identifiant entier attendu.',
      }),
    ])
  })

  it('identifiant non numérique → refusé', () => {
    expect(issuesRefus(payloadOffre({ categorie_id: 'abc' }))).toEqual([
      expect.objectContaining({
        path: ['categorie_id'],
        message: 'Catégorie : identifiant numérique attendu.',
      }),
    ])
  })
})

describe('OffreFormSchema — listes legacy type_contrat et niveau_experience', () => {
  it('toutes les valeurs des selects du blade sont acceptées', () => {
    for (const type_contrat of TYPE_CONTRAT_VALUES) {
      expect(OffreFormSchema.parse(payloadOffre({ type_contrat })).type_contrat).toBe(type_contrat)
    }
    for (const niveau_experience of NIVEAU_EXPERIENCE_VALUES) {
      expect(OffreFormSchema.parse(payloadOffre({ niveau_experience })).niveau_experience).toBe(
        niveau_experience,
      )
    }
  })

  it('type de contrat inconnu → refusé avec la liste des intitulés affichés', () => {
    expect(issuesRefus(payloadOffre({ type_contrat: 'alternance' }))).toEqual([
      expect.objectContaining({
        path: ['type_contrat'],
        message: 'Type de contrat inconnu : choisissez CDI, CDD, Stage, Freelance ou Temps partiel.',
      }),
    ])
  })

  it('niveau d’expérience inconnu → refusé avec les intitulés du blade', () => {
    expect(issuesRefus(payloadOffre({ niveau_experience: 'expert' }))).toEqual([
      expect.objectContaining({
        path: ['niveau_experience'],
        message:
          'Niveau d’expérience inconnu : choisissez Sans expérience, Junior (1-2 ans), Intermédiaire (3-5 ans) ou Senior (5+ ans).',
      }),
    ])
  })
})

describe('OffreFormSchema — ville', () => {
  it('trim et retrait des balises avant de mesurer', () => {
    expect(OffreFormSchema.parse(payloadOffre({ ville: ' <b>Douala</b> ' })).ville).toBe('Douala')
  })

  it('chaîne vide après nettoyage → refusée (champ requis)', () => {
    expect(issuesRefus(payloadOffre({ ville: '   ' }))).toEqual([
      expect.objectContaining({ path: ['ville'], message: 'La ville est requise.' }),
    ])
  })

  it('clé absente → refusée (champ requis du blade)', () => {
    expect(issuesRefus(payloadSans(PAYLOAD_OFFRE_VALIDE, 'ville'))).toEqual([
      expect.objectContaining({ path: ['ville'], message: 'Ville requise.' }),
    ])
  })

  it('101 caractères → refusée par le max 100', () => {
    expect(issuesRefus(payloadOffre({ ville: 'a'.repeat(101) }))).toEqual([
      expect.objectContaining({
        path: ['ville'],
        message: 'La ville ne doit pas dépasser 100 caractères.',
      }),
    ])
  })
})

describe('OffreFormSchema — forme de sortie (OffreFormData)', () => {
  it('un parse valide produit des salaires nombres, un booléen, un tableau d’entiers et une intention typée', () => {
    const donnees = OffreFormSchema.parse(
      payloadOffre({
        salaire_min: '150000',
        salaire_max: '300000',
        salaire_visible: 'on',
        competences: ['1', '2'],
        intention: 'publier',
      }),
    )

    expect(typeof donnees.salaire_min).toBe('number')
    expect(typeof donnees.salaire_max).toBe('number')
    expect(typeof donnees.salaire_visible).toBe('boolean')
    expect(Array.isArray(donnees.competences)).toBe(true)
    expect(donnees.competences.every((identifiant) => typeof identifiant === 'number')).toBe(true)
    expect(donnees.intention).toBe('publier')
  })

  it('les champs facultatifs restent null au lieu de basculer en 0 ou false', () => {
    const donnees = OffreFormSchema.parse(PAYLOAD_OFFRE_VALIDE)

    expect(donnees.salaire_min).toBeNull()
    expect(donnees.salaire_max).toBeNull()
    expect(donnees.salaire_visible).toBe(false)
    expect(donnees.competences).toEqual([])
    expect(donnees.intention).toBe('enregistrer')
    expect(donnees.pays).toBe('Cameroun')
  })
})
