import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reauthAdminValide } from '@/lib/admin-reauth'
import { requireAdmin } from '@/lib/dal'
import { consignerAudit } from '@/lib/journal-audit'
import { redirect } from 'next/navigation'

import { reactiverUtilisateur, suspendreUtilisateur } from './admin-utilisateurs'

// ─── Tests des actions de gestion des comptes (M10) ─────────────────────────
// Critères verrouillés :
// 1. requireAdmin() avant toute lecture, non-admin = 404 ;
// 2. identifiant et motif fermés, réauthentification avant la cible ;
// 3. un compte admin est refusé, ce qui protège structurellement le dernier
//    administrateur actif ;
// 4. suspension = isActive false + sessionVersion incrémenté + audit dans la
//    même transaction ; réactivation = isActive true + audit ;
// 5. une erreur d'audit annule l'écriture (pas d'effet sans trace).
// ---------------------------------------------------------------------------

interface ArgsFindUnique {
  where?: { id?: number }
  select?: unknown
}

interface ArgsUpdateMany {
  where?: unknown
  data?: unknown
}

interface Tx {
  user: { updateMany: typeof userUpdateMany }
}

const { userFindUnique, userUpdateMany, transaction } = vi.hoisted(() => ({
  userFindUnique: vi.fn<(args: ArgsFindUnique) => Promise<unknown>>(),
  userUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
  transaction: vi.fn<(callback: (tx: Tx) => Promise<unknown>) => Promise<unknown>>(),
}))

vi.mock('@/lib/dal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin-reauth', () => ({ reauthAdminValide: vi.fn() }))
vi.mock('@/lib/journal-audit', () => ({
  consignerAudit: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    $transaction: transaction,
  },
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const CIBLE = {
  id: 7,
  role: 'candidat',
  isActive: true,
  anonymizedAt: null,
}

function formOf(entries: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [cle, valeur] of Object.entries(entries)) formData.set(cle, valeur)
  return formData
}

function formulaireSuspension(overrides: Record<string, string> = {}): FormData {
  return formOf({ userId: '7', motif: 'comportement', ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: 42,
    role: 'admin',
    sessionVersion: 0,
  })
  vi.mocked(reauthAdminValide).mockResolvedValue(true)
  userFindUnique.mockResolvedValue(CIBLE)
  userUpdateMany.mockResolvedValue({ count: 1 })
  transaction.mockImplementation(async (callback) =>
    callback({ user: { updateMany: userUpdateMany } }),
  )
})

describe('suspendreUtilisateur', () => {
  it('refuse un non-admin avant toute lecture (404)', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'))

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )

    expect(userFindUnique).not.toHaveBeenCalled()
    expect(userUpdateMany).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('identifiant invalide = 404 avant réauthentification', async () => {
    await expect(
      suspendreUtilisateur(formOf({ userId: '12.5', motif: 'comportement' })),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(reauthAdminValide).not.toHaveBeenCalled()
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('sans réauthentification : redirection avant lecture de la cible', async () => {
    vi.mocked(reauthAdminValide).mockResolvedValueOnce(false)

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith(
      '/admin/reauth?retour=%2Fadmin%2Futilisateurs%2F7',
    )
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('motif hors catalogue : ?erreur=forme, aucune lecture', async () => {
    await expect(
      suspendreUtilisateur(formulaireSuspension({ motif: 'invente' })),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=forme')
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('refuse un compte admin, y compris le dernier actif', async () => {
    userFindUnique.mockResolvedValue({ ...CIBLE, role: 'admin' })

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=admin')
    expect(userUpdateMany).not.toHaveBeenCalled()
    expect(consignerAudit).not.toHaveBeenCalled()
  })

  it('refuse un compte anonymisé', async () => {
    userFindUnique.mockResolvedValue({ ...CIBLE, anonymizedAt: new Date() })

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=anonymise')
    expect(userUpdateMany).not.toHaveBeenCalled()
  })

  it('refuse un compte déjà suspendu', async () => {
    userFindUnique.mockResolvedValue({ ...CIBLE, isActive: false })

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith(
      '/admin/utilisateurs/7?erreur=deja_suspendu',
    )
    expect(userUpdateMany).not.toHaveBeenCalled()
  })

  it('suspend dans une transaction avec sessionVersion incrémenté et audit', async () => {
    await expect(
      suspendreUtilisateur(
        formulaireSuspension({ noteInterne: 'Plusieurs plaintes.' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        role: { not: 'admin' },
        isActive: true,
        anonymizedAt: null,
      },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    })
    expect(consignerAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        acteurId: 42,
        action: 'suspension_utilisateur',
        cibleType: 'utilisateur',
        cibleId: 7,
        motif: 'comportement',
        commentaire: 'Plusieurs plaintes.',
      }),
    )
    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?maj=suspendu')
  })

  it('course perdue (count 0) : ?erreur=statut et aucun événement', async () => {
    userUpdateMany.mockResolvedValue({ count: 0 })

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=statut')
  })

  it('une erreur d’audit annule la mutation', async () => {
    vi.mocked(consignerAudit).mockRejectedValueOnce(new Error('audit indisponible'))

    await expect(suspendreUtilisateur(formulaireSuspension())).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=inconnue')
  })
})

describe('reactiverUtilisateur', () => {
  const SUSPENDU = { ...CIBLE, isActive: false }

  it('réactive un compte suspendu et écrit l’audit', async () => {
    userFindUnique.mockResolvedValue(SUSPENDU)

    await expect(
      reactiverUtilisateur(
        formOf({ userId: '7', motif: 'demande_utilisateur' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        role: { not: 'admin' },
        isActive: false,
        anonymizedAt: null,
      },
      data: { isActive: true },
    })
    expect(consignerAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reactivation_utilisateur',
        cibleId: 7,
        motif: 'demande_utilisateur',
      }),
    )
    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?maj=reactive')
  })

  it('refuse un compte déjà actif', async () => {
    await expect(
      reactiverUtilisateur(
        formOf({ userId: '7', motif: 'demande_utilisateur' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=deja_actif')
    expect(userUpdateMany).not.toHaveBeenCalled()
  })

  it('refuse un admin et un compte anonymisé', async () => {
    userFindUnique.mockResolvedValue({ ...SUSPENDU, role: 'admin' })
    await expect(
      reactiverUtilisateur(
        formOf({ userId: '7', motif: 'demande_utilisateur' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=admin')

    vi.mocked(redirect).mockClear()
    userFindUnique.mockResolvedValue({ ...SUSPENDU, anonymizedAt: new Date() })
    await expect(
      reactiverUtilisateur(
        formOf({ userId: '7', motif: 'demande_utilisateur' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/admin/utilisateurs/7?erreur=anonymise')
  })
})
