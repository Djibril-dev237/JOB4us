import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clauseUtilisateurs,
  lireUtilisateurAdmin,
  listerUtilisateursAdmin,
} from './admin-utilisateurs-dal'

// ─── Couche de données des utilisateurs admin (M10) ─────────────────────────
// Le where de liste et de comptage est identique, les filtres sont bornés et
// le select ne contient ni mot de passe, ni secret TOTP, ni chemin de CV.
// ---------------------------------------------------------------------------

const { userCount, userFindMany, userFindUnique } = vi.hoisted(() => ({
  userCount: vi.fn<(args: unknown) => Promise<number>>(),
  userFindMany: vi.fn<(args: unknown) => Promise<unknown[]>>(),
  userFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { count: userCount, findMany: userFindMany, findUnique: userFindUnique } },
}))

const LIGNE = {
  id: 7,
  name: 'Amina',
  email: 'amina@example.test',
  role: 'candidat',
  isActive: true,
  anonymizedAt: null,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  userCount.mockResolvedValue(1)
  userFindMany.mockResolvedValue([LIGNE])
  userFindUnique.mockResolvedValue({
    ...LIGNE,
    phone: '+237600000000',
    ville: 'Douala',
    pays: 'Cameroun',
    candidat: {
      id: 3,
      titreProfil: 'Développeuse',
      _count: { candidatures: 4 },
    },
    entreprise: null,
  })
})

describe('clauseUtilisateurs', () => {
  it('combine recherche, rôle et statut sans clé inconnue', () => {
    expect(
      clauseUtilisateurs({ q: '  amina  ', role: 'candidat', statut: 'actif' }),
    ).toEqual({
      OR: [
        { name: { contains: 'amina' } },
        { email: { contains: 'amina' } },
      ],
      role: 'candidat',
      isActive: true,
    })
  })

  it('ignore une recherche vide', () => {
    expect(clauseUtilisateurs({ q: '   ' })).toEqual({})
  })
})

describe('listerUtilisateursAdmin', () => {
  it('compte et liste avec le même where, pagination bornée', async () => {
    const resultat = await listerUtilisateursAdmin({
      q: 'amina',
      role: 'candidat',
      page: 2,
    })

    const attendu = {
      OR: [
        { name: { contains: 'amina' } },
        { email: { contains: 'amina' } },
      ],
      role: 'candidat',
    }
    expect(userCount).toHaveBeenCalledWith({ where: attendu })
    expect(userFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: attendu,
      skip: 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(resultat).toMatchObject({ total: 1, page: 2, taille: 20, pages: 1 })
  })

  it('ne sélectionne aucun champ d’authentification', async () => {
    await listerUtilisateursAdmin()

    const select = (
      userFindMany.mock.calls[0]?.[0] as { select?: Record<string, unknown> }
    ).select
    expect(select).toBeDefined()
    for (const interdit of [
      'password',
      'adminTotpSecret',
      'adminTotpEnabledAt',
      'adminRecoveryCodes',
      'sessionVersion',
    ]) {
      expect(select).not.toHaveProperty(interdit)
    }
  })
})

describe('lireUtilisateurAdmin', () => {
  it('renvoie le détail avec les compteurs, sans secret ni CV', async () => {
    const detail = await lireUtilisateurAdmin(7)

    expect(detail).toMatchObject({
      id: 7,
      phone: '+237600000000',
      candidat: { id: 3, titreProfil: 'Développeuse', candidatures: 4 },
      entreprise: null,
    })

    const select = (
      userFindUnique.mock.calls[0]?.[0] as { select?: Record<string, unknown> }
    ).select
    for (const interdit of [
      'password',
      'adminTotpSecret',
      'adminTotpEnabledAt',
      'adminRecoveryCodes',
      'cvPath',
      'avatar',
    ]) {
      expect(select).not.toHaveProperty(interdit)
    }
  })

  it('renvoie null si l’utilisateur n’existe pas', async () => {
    userFindUnique.mockResolvedValue(null)

    await expect(lireUtilisateurAdmin(999)).resolves.toBeNull()
  })
})
