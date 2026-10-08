import type { NiveauExperience, TypeContrat } from '@prisma/client'

import type { DonneesFiche } from '@/components/offres/fiche-offre'
import {
  NIVEAU_EXPERIENCE_VALUES,
  TYPE_CONTRAT_VALUES,
} from '@/lib/definitions'
import { formDataString } from '@/lib/form-errors'
import type { EntrepriseFiche } from '@/lib/offres-form-dal'

// ─── Valeurs du formulaire d'offre (M6, Vague 2 — agent 2C) ──────────────────
//
// Module PUR (aucun 'use client', aucun `server-only`, aucune requête) :
// partagé par le formulaire CLIENT (lecture FormData, assembly de l'aperçu)
// et par la page serveur d'édition (pré-remplissage). Pur = testable sans
// DOM ni base : conversions Decimal/date/prefill verrouillées par
// valeurs-offre.test.ts.
//
// Les clés sont EXACTEMENT celles d'`OffreFormSchema` (titre, categorie_id,
// date_expiration…) : un seul vocabulaire entre le champ, le FormData et la
// clé d'erreur retournée par `issuesToErrors` — mapper une erreur vers son
// champ ne peut donc pas dériver.
//
// Aucune écriture ici : ce module lit et assemble, l'action serveur (2A)
// valide puis écrit. `statut`, `entrepriseId` et `slug` n'y figurent JAMAIS
// (liste blanche anti mass-assignment).
// ---------------------------------------------------------------------------

/** Clés de champ du formulaire d'offre (les mêmes que `OffreFormSchema`). */
export interface ValeursOffre {
  titre: string
  categorie_id: string
  description: string
  type_contrat: TypeContrat | ''
  niveau_experience: NiveauExperience | ''
  ville: string
  pays: string
  date_expiration: string
  salaire_min: string
  salaire_max: string
  salaire_visible: boolean
  competences: number[]
}

/**
 * Montant tel que lu côté serveur : le `Decimal` de Prisma OU un nombre
 * simple. `Number()` les traite de la même façon (decimal.js → string
 * numérique) ; surtout, cette signature rappelle qu'UN DECIMAL NE TRAVERSE
 * JAMAIS la frontière serveur → client (l'aperçu travaille en `string`).
 */
export type MontantOffre = number | { toString(): string }

/**
 * Offre modifiable telle que le pré-remplissage d'édition la lit —
 * structure exacte de `OffreModification` (src/lib/offres-dal.ts) réduite
 * aux champs consommés ici, pour que la page serveur n'ait qu'à passer le
 * résultat du chargeur et que le test puisse l'imiter sans client Prisma.
 */
export interface OffreAPreRemplir {
  titre: string
  description: string
  typeContrat: TypeContrat
  niveauExperience: NiveauExperience
  ville: string
  pays: string
  salaireMin: MontantOffre | null
  salaireMax: MontantOffre | null
  salaireVisible: boolean
  dateExpiration: Date
  categorieId: number
  competences: Array<{ competence: { id: number } }>
}

/** Lecture de select surcharged → `''` (option vide du blade). */
const VALEURS_TYPE_CONTRAT: readonly string[] = TYPE_CONTRAT_VALUES
const VALEURS_NIVEAU: readonly string[] = NIVEAU_EXPERIENCE_VALUES

export function estTypeContrat(valeur: string): valeur is TypeContrat {
  return VALEURS_TYPE_CONTRAT.includes(valeur)
}

export function estNiveauExperience(valeur: string): valeur is NiveauExperience {
  return VALEURS_NIVEAU.includes(valeur)
}

/**
 * Formulaire vierge. `pays` est pré-rempli comme le blade
 * (`old('pays', 'Cameroun')`) : c'est la valeur visible à l'ouverture de
 * /recruteur/offres/creer, pas un défaut cachu.
 */
export function valeursOffresVides(): ValeursOffre {
  return {
    titre: '',
    categorie_id: '',
    description: '',
    type_contrat: '',
    niveau_experience: '',
    ville: '',
    pays: 'Cameroun',
    date_expiration: '',
    salaire_min: '',
    salaire_max: '',
    salaire_visible: false,
    competences: [],
  }
}

/**
 * Pré-remplissage d'édition : offre modifiable → valeurs de formulaire.
 * Conversion frontière (le client ne reçoit JAMAIS un Decimal ni un Date
 * de la DAL) :
 * - `dateExpiration` (minuit UTC, colonne Date) → 'AAAA-MM-JJ', la forme
 *   imposée par `<input type="date">` (toISOString = même jour, stable) ;
 * - salaire `Decimal` → `''` si nul, sinon nombre en clair
 *   (« 150000.00 » ne doit pas s'afficher dans un champ FCFA) ;
 * - compétences cochées = ids du pivot FILTRÉS contre le catalogue affiché :
 *   une case n'existe que si le catalogue la montre, sinon le formulaire
 *   afficherait une sélection fantôme qu'aucun contrôleur ne peut décocher.
 */
export function offreEnValeurs(
  offre: OffreAPreRemplir,
  catalogueCompetences: number[],
): ValeursOffre {
  const disponibles = new Set(catalogueCompetences)

  return {
    titre: offre.titre,
    categorie_id: String(offre.categorieId),
    description: offre.description,
    type_contrat: offre.typeContrat,
    niveau_experience: offre.niveauExperience,
    ville: offre.ville,
    pays: offre.pays,
    date_expiration: offre.dateExpiration.toISOString().slice(0, 10),
    salaire_min: offre.salaireMin === null ? '' : String(Number(offre.salaireMin)),
    salaire_max: offre.salaireMax === null ? '' : String(Number(offre.salaireMax)),
    salaire_visible: offre.salaireVisible,
    competences: offre.competences
      .map((item) => item.competence.id)
      .filter((id) => disponibles.has(id)),
  }
}

/**
 * FormData → valeurs d'aperçu, par clés explicites (motif du repo, jamais de
 * désérialisation aveugle). SANS validation : c'est le reflet de ce qui est
 * saisi au moment du clic sur [Aperçu], y compris incomplet ou incohérent —
 * la validation appartient à l'action serveur au moment de l'envoi.
 *
 * Seule concession : les ids de compétence/salaire « non numériques » sont
 * écartés, faute de quoi l'aperçu afficherait NaN (un input type=number ne
 * produit pas ces valeurs, mais le DOM reste modifiable).
 */
export function lireValeursOffre(formData: FormData): ValeursOffre {
  const typeContrat = formDataString(formData.get('type_contrat'))
  const niveau = formDataString(formData.get('niveau_experience'))

  return {
    titre: formDataString(formData.get('titre')),
    categorie_id: formDataString(formData.get('categorie_id')),
    description: formDataString(formData.get('description')),
    type_contrat: estTypeContrat(typeContrat) ? typeContrat : '',
    niveau_experience: estNiveauExperience(niveau) ? niveau : '',
    ville: formDataString(formData.get('ville')),
    pays: formDataString(formData.get('pays')),
    date_expiration: formDataString(formData.get('date_expiration')),
    salaire_min: formDataString(formData.get('salaire_min')),
    salaire_max: formDataString(formData.get('salaire_max')),
    // Case SANS valeur explicite dans le blade : absente du FormData = non
    // cochée (même règle que le transform `salaire_visible` du schéma).
    salaire_visible: formData.get('salaire_visible') !== null,
    competences: [
      ...new Set(
        formData
          .getAll('competences')
          .map((valeur) => (typeof valeur === 'string' ? Number(valeur) : Number.NaN))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ],
  }
}

/** Montant saisi → nombre pour l'aperçu, `''`/illisible → `null`. */
function montantApercu(valeur: string): number | null {
  if (valeur.trim() === '') return null
  const nombre = Number(valeur)
  return Number.isFinite(nombre) ? nombre : null
}

/**
 * Assembly de l'aperçu : valeurs de formulaire → objet conforme
 * `DonneesFiche` (la fiche publique, rendue côté client AVEC SES PROPRES
 * COMPOSANTS — aucune requête, aucun rendu serveur).
 *
 * Choix documentés (aperçu = reflet, pas une édition) :
 * - `id: 0` factice : aucun lien, aucune écriture ni requête ne s'appuie
 *   dessus (l'id réel n'existe pas encore avant la création) ;
 * - `slug: null` : jamais publié, donc jamais d'URL ;
 * - `createdAt`: aujourd'hui — le formulaire ne porte pas la date de
 *   création ; `dateExpiration` vient du champ, y compris VIDE →
 *   `Invalid Date` que la fiche affiche comme une date vide (jamais de
 *   RangeError, cf. formatDate) ;
 * - `categorie`: `id: 0`/`nom: ''` tant que le select est vide (l'option
 *   « -- Choisir une catégorie -- » n'est pas une catégorie) ;
 * - `entreprise`: RÉELLE (fournie par la page) : le logo/les initiales de
 *   l'aperçu sont ceux du recruteur, pas des données inventées ;
 * - `similaires: []` : pas d'offre similaire à une offre non publiée.
 */
export function construireOffreApercu(
  valeurs: ValeursOffre,
  categories: Array<{ id: number; nom: string }>,
  catalogueCompetences: Array<{ id: number; nom: string }>,
  entreprise: EntrepriseFiche,
): DonneesFiche {
  const categorieId = Number(valeurs.categorie_id)
  const categorie = categories.find((item) => item.id === categorieId)
  const nomsCompetences = new Map(
    catalogueCompetences.map((item) => [item.id, item.nom]),
  )

  return {
    id: 0,
    titre: valeurs.titre,
    slug: null,
    description: valeurs.description,
    typeContrat: valeurs.type_contrat,
    niveauExperience: valeurs.niveau_experience,
    ville: valeurs.ville,
    pays: valeurs.pays,
    salaireMin: montantApercu(valeurs.salaire_min),
    salaireMax: montantApercu(valeurs.salaire_max),
    salaireVisible: valeurs.salaire_visible,
    dateExpiration: new Date(valeurs.date_expiration),
    createdAt: new Date(),
    categorie: categorie ?? { id: 0, nom: '' },
    entreprise,
    competences: valeurs.competences.flatMap((id) => {
      const nom = nomsCompetences.get(id)
      return nom === undefined ? [] : [{ competence: { nom } }]
    }),
  }
}
