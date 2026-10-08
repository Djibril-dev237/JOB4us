import { describe, expect, it } from 'vitest'

import {
  construireOffreApercu,
  estNiveauExperience,
  estTypeContrat,
  lireValeursOffre,
  offreEnValeurs,
  valeursOffresVides,
  type OffreAPreRemplir,
  type ValeursOffre,
} from './valeurs-offre'

// ─── Tests des conversions du formulaire d'offre (M6, agent 2C) ──────────────
// La logique PURE du formulaire (pré-remplissage d'édition, lecture du
// FormData, assembly de l'aperçu) est ici verrouillée SANS DOM ni base :
// c'est le seul point où un Decimal, une Date ou un id de catalogue change
// de forme avant d'atteindre l'écran — une régression s'y verrait en un
// message d'erreur plutôt qu'en champ vide dans l'UI.
// ---------------------------------------------------------------------------

const ENTREPRISE = {
  id: 12,
  nom: 'Camtel',
  logo: 'logo.png',
  secteurActivite: 'Informatique',
  ville: 'Douala',
} as const

const CATEGORIES = [
  { id: 3, nom: 'Informatique' },
  { id: 7, nom: 'Marketing' },
]

const CATALOGUE = [
  { id: 11, nom: 'React' },
  { id: 12, nom: 'SQL' },
]

function offreADEcouper(): OffreAPreRemplir {
  return {
    titre: 'Développeur Web',
    description: 'Poste basé à Douala.',
    typeContrat: 'CDI',
    niveauExperience: 'junior',
    ville: 'Douala',
    pays: 'Cameroun',
    // Double d'un Decimal Prisma (colonnes Decimal(10,2)) : la conversion
    // ne doit JAMAIS laisser passer « 150000.00 » dans un champ FCFA.
    salaireMin: { toString: () => '150000.00' },
    salaireMax: null,
    salaireVisible: true,
    dateExpiration: new Date('2026-11-05T00:00:00.000Z'),
    categorieId: 3,
    competences: [
      { competence: { id: 11 } },
      { competence: { id: 99 } }, // hors catalogue affiché → case fantôme écartée
    ],
  }
}

describe('offreEnValeurs (pré-remplissage d’édition)', () => {
  it('convertit la date en AAAA-MM-JJ et le Decimal en montant clair', () => {
    const valeurs = offreEnValeurs(offreADEcouper(), [11, 12])

    expect(valeurs.date_expiration).toBe('2026-11-05')
    expect(valeurs.salaire_min).toBe('150000')
    expect(valeurs.salaire_max).toBe('')
    expect(valeurs.salaire_visible).toBe(true)
  })

  it('ne garde que les compétences présentes dans le catalogue affiché', () => {
    const valeurs = offreEnValeurs(offreADEcouper(), [11, 12])
    expect(valeurs.competences).toEqual([11])

    const sansCatalogue = offreEnValeurs(offreADEcouper(), [])
    expect(sansCatalogue.competences).toEqual([])
  })

  it('reporte les champs de texte et la catégorie tels quels', () => {
    const valeurs = offreEnValeurs(offreADEcouper(), [11])

    expect(valeurs.titre).toBe('Développeur Web')
    expect(valeurs.categorie_id).toBe('3')
    expect(valeurs.type_contrat).toBe('CDI')
    expect(valeurs.niveau_experience).toBe('junior')
    expect(valeurs.pays).toBe('Cameroun')
  })
})

describe('lireValeursOffre (FormData de l’aperçu)', () => {
  function formData(parts: Array<[string, string]> = []): FormData {
    const donnees = new FormData()
    for (const [cle, valeur] of parts) donnees.append(cle, valeur)
    return donnees
  }

  it('compte une case salaire absente comme non cochée (clé omise)', () => {
    expect(lireValeursOffre(formData()).salaire_visible).toBe(false)
    expect(lireValeursOffre(formData([['salaire_visible', 'on']])).salaire_visible).toBe(
      true,
    )
  })

  it('lireValeursOffre déduplique les compétences et écarte les ids illisibles', () => {
    const valeurs = lireValeursOffre(
      formData([
        ['competences', '11'],
        ['competences', '11'],
        ['competences', 'abc'],
      ]),
    )
    expect(valeurs.competences).toEqual([11])
  })

  it('clés inconnues des selects → champ vide (aperçu sans validation)', () => {
    const valeurs = lireValeursOffre(
      formData([
        ['type_contrat', 'forfait'],
        ['niveau_experience', 'rockstar'],
        ['titre', ''],
      ]),
    )
    expect(valeurs.type_contrat).toBe('')
    expect(valeurs.niveau_experience).toBe('')
    expect(valeurs.titre).toBe('')
  })
})

describe('valeursOffresVides (création sans prefill)', () => {
  it('prépare pays « Cameroun » et un formulaire réellement vierge', () => {
    const valeurs = valeursOffresVides()
    expect(valeurs.pays).toBe('Cameroun')
    expect(valeurs.categorie_id).toBe('')
    expect(valeurs.type_contrat).toBe('')
    expect(valeurs.competences).toEqual([])
    expect(valeurs.salaire_visible).toBe(false)
  })

  it('chaque appel retourne des objets indépendants (aucun tableau partagé)', () => {
    const premier = valeursOffresVides()
    premier.competences.push(11)
    expect(valeursOffresVides().competences).toEqual([])
  })
})

describe('construireOffreApercu (assembly côté client)', () => {
  const valeurs: ValeursOffre = {
    titre: 'Développeur Web',
    categorie_id: '3',
    description: 'Poste basé à Douala.',
    type_contrat: 'CDI',
    niveau_experience: 'junior',
    ville: 'Douala',
    pays: 'Cameroun',
    date_expiration: '2026-11-05',
    salaire_min: '150000',
    salaire_max: '',
    salaire_visible: true,
    competences: [11, 99],
  }

  it('produit un objet conforme à la fiche publique (id/slug factices)', () => {
    const apercu = construireOffreApercu(valeurs, CATEGORIES, CATALOGUE, ENTREPRISE)

    expect(apercu.id).toBe(0)
    expect(apercu.slug).toBeNull()
    expect(apercu.categorie).toEqual({ id: 3, nom: 'Informatique' })
    expect(apercu.entreprise.nom).toBe('Camtel')
    // Compétence hors catalogue : jamais affichée (pas de badge inventé).
    expect(apercu.competences).toEqual([{ competence: { nom: 'React' } }])
    expect(apercu.dateExpiration.toISOString()).toContain('2026-11-05')
    expect(apercu.salaireMin).toBe(150000)
    expect(apercu.salaireMax).toBeNull()
  })

  it('champ catégorie non choisi → catégorie vide (option -- Choisir --)', () => {
    const apercu = construireOffreApercu(
      { ...valeurs, categorie_id: '' },
      CATEGORIES,
      CATALOGUE,
      ENTREPRISE,
    )
    expect(apercu.categorie).toEqual({ id: 0, nom: '' })
  })

  it('date vide ou montant illisible → jamais de NaN ni d’exception', () => {
    const apercu = construireOffreApercu(
      { ...valeurs, date_expiration: '', salaire_min: 'abc' },
      CATEGORIES,
      CATALOGUE,
      ENTREPRISE,
    )
    expect(apercu.dateExpiration.getTime()).toBeNaN()
    expect(apercu.salaireMin).toBeNull()
  })
})

describe('garde-fous de select', () => {
  it('reconnaît uniquement les valeurs de l’enum', () => {
    expect(estTypeContrat('CDI')).toBe(true)
    expect(estTypeContrat('CDD2')).toBe(false)
    expect(estNiveauExperience('senior')).toBe(true)
    expect(estNiveauExperience('expert')).toBe(false)
  })
})
