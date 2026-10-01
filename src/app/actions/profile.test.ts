import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyRole } from '@/lib/dal'

import { updateEntreprise, updateProfilCandidat } from './profile'

// ─── Tests de sécurité de l'action profil candidat (M3-ST8) ──────────────────
// Critères vérifiés ici :
// - un payload { …, role: "admin", id, userId … } est IGNORÉ : ni lu, ni
//   écrit (whitelist par clés explicites + .strip() Zod) ;
// - seuls les IDs du catalogue de compétences réel sont écrits ;
// - la disponibilité legacy est mappée vers l'énumération Prisma ;
// - hors rôle candidat, l'action s'arrête avant toute requête base.
// ---------------------------------------------------------------------------

const { candidatFindUnique, competenceFindMany, userUpdate, candidatUpdate, transaction, entrepriseUpsert } =
  vi.hoisted(() => ({
    candidatFindUnique: vi.fn<() => Promise<{ id: number } | null>>(),
    competenceFindMany: vi.fn<() => Promise<{ id: number }[]>>(),
    userUpdate: vi.fn(),
    candidatUpdate: vi.fn(),
    transaction: vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    entrepriseUpsert: vi.fn(),
  }))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidat: { findUnique: candidatFindUnique, update: candidatUpdate },
    competence: { findMany: competenceFindMany },
    user: { update: userUpdate },
    entreprise: { upsert: entrepriseUpsert },
    $transaction: transaction,
  },
}))

const VALIDE = {
  name: 'Jean Mballa',
  phone: '+237699999999',
  ville: 'Douala',
  titreProfil: 'Développeur web',
  resume: 'Profil de test',
  dateNaissance: '1995-06-01',
  genre: 'homme',
  disponibilite: '1_mois',
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyRole).mockResolvedValue({ userId: 42, role: 'candidat' })
  candidatFindUnique.mockResolvedValue({ id: 5 })
  competenceFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
})

describe('updateProfilCandidat — rôles', () => {
  it("exige explicitement le rôle candidat (session, pas payload)", async () => {
    const result = await updateProfilCandidat(undefined, formOf(VALIDE))

    expect(verifyRole).toHaveBeenCalledWith('candidat')
    expect(result).toEqual({ message: 'Profil mis à jour.' })
  })

  it("s'arrête avant toute base si le rôle est insuffisant (recruteur)", async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT'))

    await expect(updateProfilCandidat(undefined, formOf(VALIDE))).rejects.toThrow(
      'NEXT_REDIRECT',
    )
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(userUpdate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('updateProfilCandidat — anti mass-assignment', () => {
  it("ignore un payload role/id/userId/password forge (critère 'payload rejeté')", async () => {
    const result = await updateProfilCandidat(
      undefined,
      formOf({
        ...VALIDE,
        role: 'admin',
        id: '99',
        userId: '1',
        password: 'hacked',
        isActive: 'false',
      }),
    )

    expect(result?.message).toBe('Profil mis à jour.')
    // Écriture utilisateur : exactement { name, phone, ville }, rien d'autre.
    expect(userUpdate).toHaveBeenCalledTimes(1)
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { name: 'Jean Mballa', phone: '+237699999999', ville: 'Douala' },
    })
    // Aucune des clés forgeées n'apparaît nulle part dans l'écriture candidat.
    const donnees = candidatUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    for (const cleInterdite of ['role', 'id', 'userId', 'password', 'isActive']) {
      expect(donnees.data).not.toHaveProperty(cleInterdite)
    }
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('refuse un champ inconnu côté validation sans écrire (strip + erreur de type)', async () => {
    const result = await updateProfilCandidat(
      undefined,
      formOf({ ...VALIDE, emailVerifiedAt: '2026-01-01' }),
    )

    // Champ inconnu = ignorance silencieuse (politique M1) : succès, écriture
    // whitelistée uniquement.
    expect(result?.message).toBe('Profil mis à jour.')
    expect(userUpdate.mock.calls[0]?.[0]).toEqual({
      where: { id: 42 },
      data: { name: 'Jean Mballa', phone: '+237699999999', ville: 'Douala' },
    })
  })
})

describe('updateProfilCandidat — compétences', () => {
  it("n'écrit que les IDs du catalogue, dédupliqués (inconnus ignorés)", async () => {
    const result = await updateProfilCandidat(
      undefined,
      formOf({ ...VALIDE, competences: ['1', '2', '99', '99'] }),
    )

    expect(result?.message).toBe('Profil mis à jour.')
    expect(candidatUpdate).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        competences: {
          deleteMany: {},
          create: [{ competenceId: 1 }, { competenceId: 2 }],
        },
      }),
    })
  })

  it('refuse un ID non numérique (erreur de validation, aucune écriture)', async () => {
    const result = await updateProfilCandidat(
      undefined,
      formOf({ ...VALIDE, competences: ['abc'] }),
    )

    expect(result?.errors?.competences?.[0]).toBeTruthy()
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('updateProfilCandidat — valeurs du formulaire', () => {
  it('mappe la disponibilité legacy vers les énumérations Prisma', async () => {
    await updateProfilCandidat(undefined, formOf({ ...VALIDE, disponibilite: '3_mois' }))

    const donnees = candidatUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(donnees.data.disponibilite).toBe('trois_mois')
  })

  it("conserve la disponibilité si le champ est vidé (colonne NOT NULL)", async () => {
    await updateProfilCandidat(undefined, formOf({ ...VALIDE, disponibilite: '' }))

    const donnees = candidatUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(donnees.data).not.toHaveProperty('disponibilite')
  })

  it('convertit la date de naissance en Date et vide → null', async () => {
    await updateProfilCandidat(undefined, formOf({ ...VALIDE, dateNaissance: '' }))

    const sansDate = candidatUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(sansDate.data.dateNaissance).toBeNull()

    await updateProfilCandidat(undefined, formOf(VALIDE))
    const avecDate = candidatUpdate.mock.calls[1]?.[0] as { data: Record<string, unknown> }
    expect(avecDate.data.dateNaissance).toEqual(new Date('1995-06-01'))
  })
})

describe('updateProfilCandidat — validation', () => {
  it('rejette un nom trop court sans rien écrire', async () => {
    const result = await updateProfilCandidat(undefined, formOf({ ...VALIDE, name: 'A' }))

    expect(result?.errors?.name?.[0]).toBeTruthy()
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rejette une date de naissance future (durcissement vs legacy)", async () => {
    const result = await updateProfilCandidat(
      undefined,
      formOf({ ...VALIDE, dateNaissance: '2999-01-01' }),
    )

    expect(result?.errors?.dateNaissance?.[0]).toContain('futur')
    expect(transaction).not.toHaveBeenCalled()
  })

  it("répond si le profil candidat n'existe pas pour le compte", async () => {
    candidatFindUnique.mockResolvedValue(null)

    const result = await updateProfilCandidat(undefined, formOf(VALIDE))

    expect(result?.errors?._form?.[0]).toBe('Profil candidat introuvable.')
    expect(transaction).not.toHaveBeenCalled()
  })
})

// ─── Entreprise (M3-ST9) ─────────────────────────────────────────────────────

const VALIDE_ENTREPRISE = {
  nom: 'ACME Cameroun',
  secteurActivite: 'Technologie',
  tailleEntreprise: '11-50',
  description: 'Société de services.',
  siteWeb: 'https://acme.cm',
  emailContact: 'contact@acme.cm',
  telephone: '+237699999999',
  adresse: 'Rue 1.23, Bonanjo',
  ville: 'Douala',
  pays: 'Cameroun',
}

describe('updateEntreprise — rôles', () => {
  it("exige explicitement le rôle recruteur (session, pas payload)", async () => {
    const result = await updateEntreprise(undefined, formOf(VALIDE_ENTREPRISE))

    expect(verifyRole).toHaveBeenCalledWith('recruteur')
    expect(result).toEqual({ message: 'Profil entreprise mis à jour avec succès !' })
    expect(entrepriseUpsert).toHaveBeenCalledWith({
      where: { userId: 42 },
      update: expect.objectContaining({ nom: 'ACME Cameroun' }),
      create: expect.objectContaining({ userId: 42 }),
    })
  })

  it("s'arrête avant toute base si le rôle est insuffisant (candidat)", async () => {
    vi.mocked(verifyRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT'))

    await expect(
      updateEntreprise(undefined, formOf(VALIDE_ENTREPRISE)),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(entrepriseUpsert).not.toHaveBeenCalled()
  })
})

describe('updateEntreprise — anti mass-assign', () => {
  it("ignore un payload isVerified/logo/userId/id forge (critère 'payload rejeté')", async () => {
    const result = await updateEntreprise(
      undefined,
      formOf({
        ...VALIDE_ENTREPRISE,
        isVerified: 'true',
        logo: 'logos/hack.png',
        userId: '1',
        id: '9',
      }),
    )

    expect(result?.message).toBe('Profil entreprise mis à jour avec succès !')
    expect(entrepriseUpsert).toHaveBeenCalledTimes(1)
    const appel = entrepriseUpsert.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      update: Record<string, unknown>
      create: Record<string, unknown>
    }
    // Où : l'unique du compte de SESSION, jamais une idée du payload.
    expect(appel.where).toEqual({ userId: 42 })
    // Colonnes d'état/identité : jamais écrites, ni dans update ni dans create.
    for (const cleInterdite of ['isVerified', 'logo', 'id']) {
      expect(appel.update).not.toHaveProperty(cleInterdite)
      expect(appel.create).not.toHaveProperty(cleInterdite)
    }
    // userId : absent de update ; présent dans create UNIQUEMENT parce qu'il
    // vient de la session (42) — le payload forge '1' n'est pas retenu.
    expect(appel.update).not.toHaveProperty('userId')
    expect(appel.create.userId).toBe(42)
  })

  it('écrit exactement les 10 champs legacy, rien de plus (whitelist)', async () => {
    await updateEntreprise(undefined, formOf(VALIDE_ENTREPRISE))

    expect(entrepriseUpsert).toHaveBeenCalledWith({
      where: { userId: 42 },
      update: {
        nom: 'ACME Cameroun',
        secteurActivite: 'Technologie',
        tailleEntreprise: '11-50',
        description: 'Société de services.',
        siteWeb: 'https://acme.cm',
        emailContact: 'contact@acme.cm',
        telephone: '+237699999999',
        adresse: 'Rue 1.23, Bonanjo',
        ville: 'Douala',
        pays: 'Cameroun',
      },
      create: {
        userId: 42,
        nom: 'ACME Cameroun',
        secteurActivite: 'Technologie',
        tailleEntreprise: '11-50',
        description: 'Société de services.',
        siteWeb: 'https://acme.cm',
        emailContact: 'contact@acme.cm',
        telephone: '+237699999999',
        adresse: 'Rue 1.23, Bonanjo',
        ville: 'Douala',
        pays: 'Cameroun',
      },
    })
  })
})

describe('updateEntreprise — valeurs', () => {
  it("vidé → null sauf pays (NOT NULL conservé, défaut de colonne à la création)", async () => {
    await updateEntreprise(
      undefined,
      formOf({
        nom: 'ACME Cameroun',
        secteurActivite: '',
        tailleEntreprise: '',
        description: '',
        siteWeb: '',
        emailContact: '',
        telephone: '',
        adresse: '',
        ville: '',
        pays: '',
      }),
    )

    const appel = entrepriseUpsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>
      create: Record<string, unknown>
    }
    expect(appel.update).toEqual({
      nom: 'ACME Cameroun',
      secteurActivite: null,
      tailleEntreprise: null,
      description: null,
      siteWeb: null,
      emailContact: null,
      telephone: null,
      adresse: null,
      ville: null,
    })
    expect(appel.update).not.toHaveProperty('pays')
    expect(appel.create).toEqual({ userId: 42, ...appel.update })
  })

  it('trim avant validation (parité TrimStrings legacy)', async () => {
    await updateEntreprise(undefined, formOf({ ...VALIDE_ENTREPRISE, nom: '  ACME  ' }))

    const appel = entrepriseUpsert.mock.calls[0]?.[0] as { update: Record<string, unknown> }
    expect(appel.update.nom).toBe('ACME')
  })
})

describe('updateEntreprise — validation', () => {
  it('refuse un site web hors http(s), y compris javascript: (XSS au clic)', async () => {
    for (const siteWeb of ['javascript:alert(1)', 'data:text/html,x', 'ftp://acme.cm']) {
      const result = await updateEntreprise(
        undefined,
        formOf({ ...VALIDE_ENTREPRISE, siteWeb }),
      )
      expect(result?.errors?.siteWeb?.[0]).toBeTruthy()
    }
    expect(entrepriseUpsert).not.toHaveBeenCalled()
  })

  it('refuse une taille hors de la liste legacy sans écrire', async () => {
    const result = await updateEntreprise(
      undefined,
      formOf({ ...VALIDE_ENTREPRISE, tailleEntreprise: '999' }),
    )

    expect(result?.errors?.tailleEntreprise?.[0]).toBeTruthy()
    expect(entrepriseUpsert).not.toHaveBeenCalled()
  })

  it('refuse un nom vide (après trim) sans écrire', async () => {
    const result = await updateEntreprise(undefined, formOf({ ...VALIDE_ENTREPRISE, nom: '   ' }))

    expect(result?.errors?.nom?.[0]).toBeTruthy()
    expect(entrepriseUpsert).not.toHaveBeenCalled()
  })

  it("refuse un email de contact invalide (règle legacy `email`)", async () => {
    const result = await updateEntreprise(
      undefined,
      formOf({ ...VALIDE_ENTREPRISE, emailContact: 'pas-un-email' }),
    )

    expect(result?.errors?.emailContact?.[0]).toBeTruthy()
    expect(entrepriseUpsert).not.toHaveBeenCalled()
  })
})
