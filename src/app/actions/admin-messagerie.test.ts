import { Prisma } from '@prisma/client'
import type { Prisma as NsPrisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifySession } from '@/lib/dal'

import { traiterSignalement } from './admin-messagerie'

// ─── Tests de l'action de modération admin (M8, Vague 3) ─────────────────────
// Trois critères verrouillés ici :
// 1. ORDRE DE CONTRÔLE : un refus précoce (rôle, forme) n'a AUCUN effet de
//    bord — zéro `updateMany`, zéro `findFirst`. Zod et `nettoyerMotif`
//    tournent POUR DE VRAI (motif du fichier jumeau messagerie.test.ts).
// 2. COMPARE-AND-SET : le `where` de l'`updateMany` porte `statut: 'ouvert'`
//    exact ; `count === 0` est décomposé en « déjà traité » (idempotent, zéro
//    seconde écriture) vs « inexistant » (panne générique).
// 3. AUCUNE DONNÉE PERSONNELLE en log : le catch ne journalise que l'id du
//    signalement et le code Prisma — jamais la note, jamais un nom.
//
// Patron repris de src/app/actions/messagerie.test.ts : prisma/dal mockés,
// aucune requête réelle, verdicts assertés au mot.
// ---------------------------------------------------------------------------

// ─── Types des doubles (aucun `any` : lecture des arguments réels) ───────────

interface ArgsSignalementUpdateMany {
  where?: NsPrisma.SignalementWhereInput
  // `UncheckedUpdateManyInput` et non `UpdateManyMutationInput` : les clés
  // FK (`traiteParId`) n'existent QUE dans la variante unchecked — le
  // client réel `updateMany` accepte l'une comme l'autre, notre
  // interface-artefact doit refléter l'objet RÉELLEMENT passé.
  data?: NsPrisma.SignalementUncheckedUpdateManyInput
}

interface ArgsSignalementFindFirst {
  where?: NsPrisma.SignalementWhereInput
  select?: unknown
}

const { updateMany, findFirst } = vi.hoisted(() => ({
  updateMany: vi.fn<(args: ArgsSignalementUpdateMany) => Promise<{ count: number }>>(),
  findFirst: vi.fn<(args: ArgsSignalementFindFirst) => Promise<unknown>>(),
}))

// Seules les deux méthodes utilisées par l'action sont exposées : une
// requête imprévue lèverait une TypeError et casserait le test.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    signalement: { updateMany, findFirst },
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_ID = 7
const SIGNALEMENT_ID = 42

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(verifySession).mockResolvedValue({ userId: ADMIN_ID, role: 'admin' })
  updateMany.mockImplementation(async () => ({ count: 1 }))
  findFirst.mockImplementation(async () => null)
})

// ─── Clôture valide : compare-and-set + verdict ──────────────────────────────

describe('traiterSignalement — clôture d’un signalement ouvert', () => {
  it('admin + id valide + note : where { id, statut: ouvert } exact, data attendu, { ok: true, deja: false }', async () => {
    const resultat = await traiterSignalement({
      signalementId: SIGNALEMENT_ID,
      noteInterne: 'Escalade vers l’équipe confiance.',
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    const args = updateMany.mock.calls[0]?.[0]
    // Le `where` porte l’id ET le statut : c’est LUI qui empêche deux
    // admins d’écraser la note l’un de l’autre.
    expect(args?.where).toEqual({ id: SIGNALEMENT_ID, statut: 'ouvert' })
    expect(args?.data).toEqual({
      statut: 'traite',
      traiteParId: ADMIN_ID,
      traiteLe: expect.any(Date),
      noteInterne: 'Escalade vers l’équipe confiance.',
    })
    // Décompte 1 : aucun besoin d’identifier la ligne (zéro seconde lecture).
    expect(findFirst).not.toHaveBeenCalled()
    expect(resultat).toEqual({ ok: true, deja: false })
  })

  it('note nulle : acceptée, `noteInterne: null` dans le data', async () => {
    const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: null })

    expect(resultat).toEqual({ ok: true, deja: false })
    expect(updateMany.mock.calls[0]?.[0]?.data?.noteInterne).toBeNull()
    expect(updateMany.mock.calls[0]?.[0]?.data?.traiteParId).toBe(ADMIN_ID)
  })

  it('note absente (undefined) : même verdict, noteInterne null stockée', async () => {
    // `undefined` hors contrat TS (le type dit `string | null`) mais atteignable
    // à l’exécution : le schema l’accepte (optionnel) et stocke `null`.
    const resultat = await traiterSignalement({
      signalementId: SIGNALEMENT_ID,
      noteInterne: undefined,
    } as unknown as { signalementId: number; noteInterne: string | null })

    expect(resultat).toEqual({ ok: true, deja: false })
    expect(updateMany.mock.calls[0]?.[0]?.data?.noteInterne).toBeNull()
  })

  it('note blanche ou balisée : nettoyée par nettoyerMotif (vide → null, balises retirées)', async () => {
    await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: '   ' })
    expect(updateMany.mock.calls[0]?.[0]?.data?.noteInterne).toBeNull()

    updateMany.mockClear()
    await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: '  <b>Escalade</b>  ' })
    // Nettoyage VRAI du module contenu : trim + retrait de balises.
    expect(updateMany.mock.calls[0]?.[0]?.data?.noteInterne).toBe('Escalade')
  })
})

// ─── Idempotence : le verdict « déjà » distingue l’absence ───────────────────

describe('traiterSignalement — clôture répétée (idempotence)', () => {
  it('count 0 + signalement existant : { ok: true, deja: true }, findFirst sur le seul id, zéro seconde écriture', async () => {
    updateMany.mockImplementation(async () => ({ count: 0 }))
    findFirst.mockImplementation(async () => ({ id: SIGNALEMENT_ID }))

    const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: null })

    expect(resultat).toEqual({ ok: true, deja: true })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: SIGNALEMENT_ID },
      select: { id: true },
    })
    // Une seule tentative d’écriture : le « déjà traité » ne réécrit RIEN.
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('count 0 + signalement absent : { ok: false, erreur: inconnue }', async () => {
    updateMany.mockImplementation(async () => ({ count: 0 }))
    findFirst.mockImplementation(async () => null)

    const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: null })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
  })
})

// ─── Refus précoces : zéro effet de bord ─────────────────────────────────────

describe('traiterSignalement — chaque refus précoce est sans lecture ni écriture', () => {
  it("rôle non-admin : 'inconnue', zéro lecture, zéro écriture", async () => {
    // L’admin est le SEUL acteur admis : ni candidat, ni recruteur.
    for (const role of ['candidat', 'recruteur'] as const) {
      vi.mocked(verifySession).mockResolvedValue({ userId: ADMIN_ID, role })

      const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: null })

      expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    }
    expect(updateMany).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("payload hors schema : 'inconnue', zéro lecture, zéro écriture", async () => {
    // Cas forgés : id nul, négatif, hors Int32, fractionnaire, note trop
    // longue (garde brute) et clé inconnue (`.strict()`).
    await traiterSignalement({ signalementId: 0, noteInterne: null })
    await traiterSignalement({ signalementId: -1, noteInterne: null })
    await traiterSignalement({ signalementId: 1.5, noteInterne: null })
    await traiterSignalement({ signalementId: 2_147_483_648, noteInterne: null })
    await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: 'x'.repeat(2001) })
    await traiterSignalement({
      signalementId: SIGNALEMENT_ID,
      noteInterne: null,
      traiteParId: 999,
    } as unknown as { signalementId: number; noteInterne: string | null })
    await traiterSignalement({
      signalementId: 'x',
      noteInterne: null,
    } as unknown as { signalementId: number; noteInterne: string | null })

    expect(updateMany).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("payload null (appel forgé) : 'inconnue', zéro lecture, zéro écriture — jamais de 500", async () => {
    // Un payload `null` (client forgé, bug d'appel) ne doit pas faire
    // échouer l'action par une TypeError hors try/catch : le verdict
    // générique s'applique, AUCUN accès base.
    const resultat = await traiterSignalement(
      null as unknown as { signalementId: number; noteInterne: string | null },
    )

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(updateMany).not.toHaveBeenCalled()
    expect(findFirst).not.toHaveBeenCalled()
  })
})

// ─── Erreur DB : verdict générique, log sans PII ─────────────────────────────

describe('traiterSignalement — erreur DB inattendue', () => {
  it("updateMany qui lève : 'inconnue', log SANS donnée personnelle (ni note, ni nom)", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    updateMany.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await traiterSignalement({
      signalementId: SIGNALEMENT_ID,
      noteInterne: 'Secret 06 12 34 56 78',
    })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(findFirst).not.toHaveBeenCalled()

    // Un SEUL log, dont l’objet ne contient QUE l’id et le code.
    expect(consoleError).toHaveBeenCalledTimes(1)
    const [marque, donnees] = consoleError.mock.calls[0] ?? []
    expect(marque).toBe('[admin-messagerie] cloture')
    expect(donnees).toEqual({ signalementId: SIGNALEMENT_ID, code: 'INCONNU' })
    expect(Object.keys(donnees ?? {}).sort()).toEqual(['code', 'signalementId'])
    expect(JSON.stringify(donnees)).not.toContain('Secret')
    expect(JSON.stringify(donnees)).not.toContain(String(ADMIN_ID))

    consoleError.mockRestore()
  })

  it('erreur Prisma connue : le code utile au diagnostic est loggé (toujours sans note)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    updateMany.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('write timeout', {
        code: 'P2025',
        clientVersion: '6.19.3',
      })
    })

    const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: 'Privée' })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledWith('[admin-messagerie] cloture', {
      signalementId: SIGNALEMENT_ID,
      code: 'P2025',
    })

    consoleError.mockRestore()
  })

  it("findFirst qui lève après count 0 : 'inconnue' (aucune exception ne sort de l’action)", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    updateMany.mockImplementation(async () => ({ count: 0 }))
    findFirst.mockImplementation(async () => {
      throw new Error('DB_DOWN')
    })

    const resultat = await traiterSignalement({ signalementId: SIGNALEMENT_ID, noteInterne: null })

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(consoleError).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })
})
