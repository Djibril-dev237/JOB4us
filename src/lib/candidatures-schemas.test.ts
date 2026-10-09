import { StatutCandidature } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  schemaChangementStatut,
  schemaFiltreCandidatures,
  schemaPostulation,
  type PostulationClient,
} from './candidatures-schemas'

// ─── Contrats des schémas M7 ─────────────────────────────────────────────────
// Verrouillent la liste blanche (Étape 2, tâche 2) : clés interdites rejetées
// (`statut`, `candidatId`/`candidateId`, `offreId`, `cvPath`), bornes de la
// lettre (3000), source du CV (fichier requis / interdit), coercitions de la
// query string et rejet de `page: 0` ou d'un statut hors enum.
// ---------------------------------------------------------------------------

function cvFichier(): File {
  return new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' })
}

/** Clés qui ne doivent JAMAIS revenir d'un payload client, avec leur valeur. */
const INJECTIONS: ReadonlyArray<[cle: string, valeur: unknown]> = [
  ['statut', 'envoyee'],
  ['candidatId', 7],
  ['candidateId', 7],
  ['offreId', 3],
  ['cvPath', 'candidatures/cv.pdf'],
]

describe('schemaPostulation — payload valide', () => {
  it('accepte une postulation depuis le CV du profil (sans fichier)', () => {
    const payload: PostulationClient = {
      sourceCv: 'profil',
      lettreMotivation: 'Motivation pour le poste.',
    }
    const donnees = schemaPostulation.parse(payload)

    expect(donnees).toEqual(payload)
    expect(donnees.fichier).toBeUndefined()
  })

  it('accepte une postulation sans lettre de motivation (legacy nullable)', () => {
    const payload: PostulationClient = { sourceCv: 'profil' }
    const donnees = schemaPostulation.parse(payload)

    expect(donnees.sourceCv).toBe('profil')
    expect(donnees.lettreMotivation).toBeUndefined()
  })

  it('accepte un fichier CV (source fichier) et le retourne identique', () => {
    const fichier = cvFichier()
    const donnees = schemaPostulation.parse({ sourceCv: 'fichier', fichier })

    expect(donnees.sourceCv).toBe('fichier')
    expect(donnees.fichier).toBe(fichier)
    expect(donnees.lettreMotivation).toBeUndefined()
  })
})

describe('schemaPostulation — liste blanche (.strict())', () => {
  it.each(INJECTIONS)('rejette la clé injectée « %s »', (cle, valeur) => {
    const resultat = schemaPostulation.safeParse({
      sourceCv: 'profil',
      [cle]: valeur,
    })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys')
      // Le nom de la clé refusée doit figurer dans le message d'issue.
      expect(resultat.error.message).toContain(cle)
    }
  })

  it('rejette un statut inconnu injecté (clé interdite, valeur ou non)', () => {
    const resultat = schemaPostulation.safeParse({
      sourceCv: 'profil',
      statut: 'inconnu',
    })

    expect(resultat.success).toBe(false)
  })
})

describe('schemaPostulation — lettre de motivation (max 3000)', () => {
  it('accepte exactement 3000 caractères', () => {
    const donnees = schemaPostulation.parse({
      sourceCv: 'profil',
      lettreMotivation: 'a'.repeat(3000),
    })

    expect(donnees.lettreMotivation).toHaveLength(3000)
  })

  it('rejette 3001 caractères (borne du legacy max:3000)', () => {
    const resultat = schemaPostulation.safeParse({
      sourceCv: 'profil',
      lettreMotivation: 'a'.repeat(3001),
    })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.path).toEqual(['lettreMotivation'])
    }
  })
})

describe('schemaPostulation — source du CV (option A validée)', () => {
  it('rejette « fichier » sans fichier joint', () => {
    const resultat = schemaPostulation.safeParse({ sourceCv: 'fichier' })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.path).toEqual(['fichier'])
    }
  })

  it('accepte « profil » sans fichier (le serveur lit Candidat.cvPath)', () => {
    expect(schemaPostulation.safeParse({ sourceCv: 'profil' }).success).toBe(true)
  })

  it('rejette « profil » avec un fichier joint (le CV vient du profil)', () => {
    const resultat = schemaPostulation.safeParse({
      sourceCv: 'profil',
      fichier: cvFichier(),
    })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.path).toEqual(['fichier'])
    }
  })

  it('rejette une source hors liste et un fichier qui n’est pas un File', () => {
    expect(schemaPostulation.safeParse({ sourceCv: 'ftp' }).success).toBe(false)
    expect(
      schemaPostulation.safeParse({ sourceCv: 'fichier', fichier: 'cv.pdf' }).success,
    ).toBe(false)
  })
})

describe('schemaChangementStatut — 7 cibles, rien d’autre', () => {
  it('accepte chacune des 7 valeurs de l’enum Prisma', () => {
    const ecarts: string[] = []
    for (const statut of Object.values(StatutCandidature)) {
      const resultat = schemaChangementStatut.safeParse({ statut })
      if (!resultat.success) {
        ecarts.push(statut)
      } else {
        expect(resultat.data.statut).toBe(statut)
      }
    }
    expect(ecarts).toEqual([])
    expect(Object.values(StatutCandidature)).toHaveLength(7)
  })

  it('rejette toute valeur hors liste (dont les statuts legacy)', () => {
    for (const statut of ['vue', 'retenue', 'brouillon', 'envoyee2', 'inconnue']) {
      expect(schemaChangementStatut.safeParse({ statut }).success).toBe(false)
    }
  })

  it('rejette un payload sans statut (champ requis)', () => {
    expect(schemaChangementStatut.safeParse({}).success).toBe(false)
  })

  it('rejette tout autre champ (la cible vient de l’URL, pas du formulaire)', () => {
    const resultat = schemaChangementStatut.safeParse({
      statut: 'acceptee',
      candidatId: 7,
      candidateId: 7,
      offreId: 3,
    })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys')
    }
  })
})

describe('schemaFiltreCandidatures — query string (lecture seule)', () => {
  it('accepte une query vide (aucun filtre)', () => {
    const donnees = schemaFiltreCandidatures.parse({})

    expect(donnees.statut).toBeUndefined()
    expect(donnees.page).toBeUndefined()
    expect(donnees.offreId).toBeUndefined()
  })

  it('coercitionne page et offreId depuis la chaîne de l’URL (nom aligné DAL, O3)', () => {
    const donnees = schemaFiltreCandidatures.parse({
      statut: 'envoyee',
      page: '2',
      offreId: '7',
    })

    expect(donnees).toEqual({ statut: 'envoyee', page: 2, offreId: 7 })
  })

  it('rejette un id d’offre non entier ou < 1', () => {
    for (const offreId of [0, -3, 2.5, 'abc']) {
      expect(schemaFiltreCandidatures.safeParse({ offreId }).success).toBe(false)
    }
  })

  it('rejette page: 0 et les pages non entières / non numériques', () => {
    for (const page of [0, '0', -1, 1.5, 'abc']) {
      expect(schemaFiltreCandidatures.safeParse({ page }).success).toBe(false)
    }
  })

  it('rejette un statut hors des 7 valeurs de l’enum', () => {
    for (const statut of ['vue', 'retenue', 'brouillon', 'inconnue']) {
      expect(schemaFiltreCandidatures.safeParse({ statut }).success).toBe(false)
    }
    expect(schemaFiltreCandidatures.safeParse({ statut: 'retiree' }).success).toBe(true)
  })

  it('rejette toute clé inconnue (.strict(), y compris hors filtre)', () => {
    const resultat = schemaFiltreCandidatures.safeParse({
      page: '2',
      candidateId: '3',
    })

    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys')
    }
  })
})
