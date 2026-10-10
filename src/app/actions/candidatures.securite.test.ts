import type { StatutCandidature } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ACTION_AUDIT_CREATION,
  ACTION_AUDIT_RETRAIT,
  ACTION_AUDIT_TRANSITION,
} from '@/lib/candidature-audit'
import { annulerSnapshotCv, preparerSnapshotCv } from '@/lib/candidature-cv'
import {
  STATUTS,
  STATUTS_TERMINAUX,
  messageErreurCandidature,
  messageMajCandidature,
  peutTransiter,
} from '@/lib/candidatures-labels'
import { schemaChangementStatut, schemaPostulation } from '@/lib/candidatures-schemas'
import { verifyRole } from '@/lib/dal'
import {
  candidatureEnvoyee,
  candidatureRetiree,
  statutChange,
} from '@/lib/evenements-candidature'
import type { OffreDetail } from '@/lib/offres-public'
import { lireOffrePublique } from '@/lib/offres-public'
import {
  CANDIDATURES_MAX_PAR_COMPTE,
  CANDIDATURES_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'
import { notFound, redirect } from 'next/navigation'

import {
  changerStatutCandidature,
  marquerConsultee,
  postulerOffre,
  retirerCandidature,
} from './candidatures'

// ─── Tests de SÉCURITÉ des actions serveur M7 (V3-J, vague transverse) ───────
// Ces tests n'AMÉLIORENT rien : ils PRouvent les refus déjà verrouillés dans
// src/app/actions/candidatures.ts, sous 8 angles d'attaque (numérotés « cas »
// selon la spec V3-J) :
//   cas 1  mass-assignment : un FormData hostile ne peut ni écrire l'audit
//          (`acteurId`/`action`/`candidatureId`/`audit`) ni la ligne ;
//   cas 2  matrice des transitions : toute combinaison hors TRANSITIONS est
//          refusée AVANT le compare-and-set ;
//   cas 3  l'audit n'existe QUE si la mutation a eu lieu (CAS à 1) — un
//          échec d'audit roule la $transaction entière ;
//   cas 4  acteur = session, périmètre = jointure offre → entreprise →
//          userId, DANS le `where` de la lecture ET dans celui du CAS ;
//   cas 5  rôle : candidat ne change jamais un statut, recruteur ne retire
//          jamais (garde verifyRole, puis défense en profondeur) ;
//   cas 6  oracle d'existence P2-1 : brouillon ≡ slug absent (même 404) ;
//   cas 7  marquerConsultee : garde + scoping + audit best-effort atomique ;
//   cas 8  retrait atomique (CAS portant périmètre + exclusion des terminaux).
//
// Patterns repris AU MOT de candidatures.test.ts : prisma/dal/offres-public/
// candidature-cv/rate-limit/hooks mockés, redirect/notFound LÈVENT (comme en
// production) pour que le flux s'arrête sur son verdict. Le module d'audit
// (src/lib/candidature-audit.ts) n'est PAS mocké : il tourne pour de vrai sur
// le client simulé.
//
// NOVÉAUTÉ V3-J : `$transaction` est simulée avec sémantique de ROLLBACK —
// les effets (statut, création, ligne d'audit) sont d'abord écrits dans une
// OMBRE, puis committés dans `base` UNIQUEMENT si le callback se termine.
// `candidature.updateMany` applique le CAS pour de bon (évaluation du `where`
// contre la ligne de `base`) : « CAS à zéro » et « échec d'audit ⇒ rollback »
// sont donc des comportements OBSERVÉS, pas des retours pré-enregistrés.
// ---------------------------------------------------------------------------

// ─── Types des doubles (aucun `any` : lecture exacte des arguments réels) ────

/** Ligne de `Candidature` telle que la $transaction la manipule. */
interface LigneSimulee {
  id: number
  statut: StatutCandidature
  candidatId: number
  offreId: number
  /** `userId` de l'entreprise employeuse (jongle recruteur de l'offre). */
  offreUserId: number
}

/** Lecture de contrôle retournée par findUnique/findFirst (select LIMITÉ). */
interface ControleLigne {
  statut: StatutCandidature
  offreId: number
  candidatId: number
}

/** `where` des `updateMany` M7 (périmètre + statut source). */
interface WhereCas {
  id: number
  candidatId?: number
  statut?: StatutCandidature | { notIn: readonly StatutCandidature[] }
  offre?: { entreprise: { userId: number } }
}

interface ArgsUpdateMany {
  where: WhereCas
  data: { statut: StatutCandidature }
}

/** Payload réellement écrit par `journaliserCandidature`. */
interface TraceAudit {
  candidatureId: number
  acteurId: number
  action: string
  ancienStatut: string | null
  nouveauStatut: string | null
}

interface ArgsAudit {
  data: TraceAudit
}

/** `data` du `candidature.create` — liste blanche de postulerOffre. */
interface DataCreation {
  offreId: number
  candidatId: number
  lettreMotivation: string | null
  cvPath: string
}

interface ArgsCreation {
  data: DataCreation
}

type LigneCreee = DataCreation & { id: number }

/** `where` des lectures de contrôle : id, et périmètre scopé du recruteur. */
interface ArgsFindLigne {
  where: { id: number; offre?: { entreprise: { userId: number } } }
  select?: unknown
}

/** Client transactif simulé : seules les 3 opérations M7 existent. */
interface TxSimulee {
  candidature: {
    updateMany: (args: ArgsUpdateMany) => Promise<{ count: number }>
    create: (args: ArgsCreation) => Promise<LigneCreee>
  }
  auditCandidature: {
    create: (args: ArgsAudit) => Promise<TraceAudit>
  }
}

const {
  auditCandidatureCreate,
  candidatureCreate,
  candidatureFindUnique,
  candidatureFindFirst,
  candidatureUpdateMany,
  candidatFindUnique,
  offreFindUnique,
  transaction,
} = vi.hoisted(() => ({
  auditCandidatureCreate: vi.fn<(args: ArgsAudit) => Promise<TraceAudit>>(),
  candidatureCreate: vi.fn<(args: ArgsCreation) => Promise<LigneCreee>>(),
  candidatureFindUnique: vi.fn<(args: ArgsFindLigne) => Promise<ControleLigne | null>>(),
  candidatureFindFirst: vi.fn<(args: ArgsFindLigne) => Promise<ControleLigne | null>>(),
  candidatureUpdateMany: vi.fn<(args: ArgsUpdateMany) => Promise<{ count: number }>>(),
  candidatFindUnique: vi.fn<(args: unknown) => Promise<{ id: number } | null>>(),
  offreFindUnique: vi.fn<(args: unknown) => Promise<{ statut: string } | null>>(),
  transaction: vi.fn<(fn: (tx: TxSimulee) => Promise<unknown>) => Promise<unknown>>(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidature: {
      create: candidatureCreate,
      findUnique: candidatureFindUnique,
      findFirst: candidatureFindFirst,
      updateMany: candidatureUpdateMany,
    },
    candidat: { findUnique: candidatFindUnique },
    offre: { findUnique: offreFindUnique },
    auditCandidature: { create: auditCandidatureCreate },
    $transaction: transaction,
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

vi.mock('@/lib/offres-public', () => ({
  lireOffrePublique: vi.fn(),
}))

vi.mock('@/lib/candidature-cv', () => ({
  preparerSnapshotCv: vi.fn(),
  annulerSnapshotCv: vi.fn(),
}))

// Seau mocké mais politiques RÉELLES importées : un écart de plafond ou de
// fenêtre casserait le contrat sans casser les mocks.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...original, checkRateLimit: vi.fn(), recordAttempt: vi.fn() }
})

// Spies exécutant le hook réel (no-op) : les verdicts ne peuvent pas en
// dépendre, et « les 3 restent sans effet » reste vérifiable.
vi.mock('@/lib/evenements-candidature', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/evenements-candidature')>()
  return {
    candidatureEnvoyee: vi.fn(original.candidatureEnvoyee),
    candidatureRetiree: vi.fn(original.candidatureRetiree),
    statutChange: vi.fn(original.statutChange),
  }
})

// redirect() et notFound() lèvent en production : les mocks font pareil,
// sinon l'action continuerait après son verdict.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

// ─── Base simulée + sémantique de transaction (rollback observé) ────────────

interface BaseSimulee {
  ligne: LigneSimulee | null
  creations: LigneCreee[]
  audits: TraceAudit[]
}

const base: BaseSimulee = { ligne: null, creations: [], audits: [] }

/** Ligne de `base` pour les fixtures (null = ligne absente en base). */
function ligneDeBase(): LigneSimulee {
  const ligne = base.ligne
  if (ligne === null) throw new Error('fixture : aucune ligne de base')
  return ligne
}

/** Effets d'une $transaction en cours — committés seulement si le tx réussit. */
interface Ombre {
  statut: StatutCandidature | null
  creations: LigneCreee[]
  audits: TraceAudit[]
}

let ombre: Ombre = { statut: null, creations: [], audits: [] }

/**
 * Compare-and-set : le `where` voyage AVEC le périmètre et la source, il est
 * donc ÉVALUÉ contre la ligne de `base` (comme le ferait la base).
 */
function casEquivaut(where: WhereCas, ligne: LigneSimulee): boolean {
  if (where.id !== ligne.id) return false
  if (where.candidatId !== undefined && where.candidatId !== ligne.candidatId) return false
  const statut = where.statut
  if (typeof statut === 'string') {
    if (statut !== ligne.statut) return false
  } else if (statut !== undefined) {
    if (statut.notIn.includes(ligne.statut)) return false
  }
  if (where.offre !== undefined && where.offre.entreprise.userId !== ligne.offreUserId) {
    return false
  }
  return true
}

const TX: TxSimulee = {
  candidature: {
    updateMany: async (args) => {
      const verdict = await candidatureUpdateMany(args)
      if (verdict.count === 1) ombre.statut = args.data.statut
      return verdict
    },
    create: async (args) => {
      const ligne = await candidatureCreate(args)
      ombre.creations.push(ligne)
      return ligne
    },
  },
  auditCandidature: {
    create: async (args) => {
      const trace = await auditCandidatureCreate(args)
      ombre.audits.push(args.data)
      return trace
    },
  },
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 42
const CANDIDAT_ID = 7
const OFFRE_ID = 42
const CANDIDATURE_ID = 900
const SLUG = 'developpeur-back-end-42'
const CLE_SNAPSHOT = 'candidatures/abc-123.pdf'
const CLE_SEAU = `candidatures:postulation:${USER_ID}`
const LETTRE = 'Je suis motivé pour ce poste.'

/** Le module est mocké : l'action n'en lit que l'`id` de l'offre visible. */
const OFFRE_VISIBLE = { id: OFFRE_ID } as unknown as OffreDetail

const FORM_POSTULATION: Record<string, string> = {
  slug: SLUG,
  lettreMotivation: LETTRE,
  sourceCv: 'profil',
}
const FORM_RETRAIT: Record<string, string> = { id: String(CANDIDATURE_ID) }
const FORM_TRANSITION: Record<string, string> = {
  id: String(CANDIDATURE_ID),
  vers: 'consultee',
}

function formOf(entries: Record<string, string | File>): FormData {
  const formData = new FormData()
  for (const [cle, valeur] of Object.entries(entries)) formData.set(cle, valeur)
  return formData
}

/** Premier `data` passé à `candidature.create`. */
function dataCreation(): DataCreation | undefined {
  return candidatureCreate.mock.calls[0]?.[0]?.data
}

/** Premier `where` passé à `candidature.updateMany`. */
function whereUpdateMany(): WhereCas | undefined {
  return candidatureUpdateMany.mock.calls[0]?.[0]?.where
}

/** Message de l'erreur qui a arrêté l'action (REDIRECT:…, NOT_FOUND, autre). */
async function symptome(action: Promise<unknown>): Promise<string> {
  try {
    await action
    return 'AUCUN_VERDICT'
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : 'ERREUR_INCONNUE'
  }
}

async function attendRedirection(action: Promise<unknown>, url: string): Promise<void> {
  await expect(action).rejects.toThrow(`REDIRECT:${url}`)
  expect(redirect).toHaveBeenCalledWith(url)
  expect(notFound).not.toHaveBeenCalled()
}

async function attend404(action: Promise<unknown>): Promise<void> {
  await expect(action).rejects.toThrow('NOT_FOUND')
  expect(notFound).toHaveBeenCalledTimes(1)
  expect(redirect).not.toHaveBeenCalled()
}

/** URL portée par une redirection `REDIRECT:<url>`. */
async function capturerRedirection(action: Promise<unknown>): Promise<string> {
  const message = await symptome(action)
  expect(message.startsWith('REDIRECT:')).toBe(true)
  return message.slice('REDIRECT:'.length)
}

function parametre(url: string, nom: string): string | null {
  const position = url.indexOf('?')
  return position === -1 ? null : new URLSearchParams(url.slice(position + 1)).get(nom)
}

beforeEach(() => {
  vi.clearAllMocks()

  base.ligne = {
    id: CANDIDATURE_ID,
    statut: 'envoyee',
    candidatId: CANDIDAT_ID,
    offreId: OFFRE_ID,
    // Ligne de base : portée par l'offre du recruteur de la SESSION (42) —
    // les cas de scoping la réattribuent explicitement à une autre entreprise.
    offreUserId: USER_ID,
  }
  base.creations = []
  base.audits = []

  vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
  vi.mocked(lireOffrePublique).mockResolvedValue(OFFRE_VISIBLE)
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 })
  vi.mocked(preparerSnapshotCv).mockResolvedValue({ ok: true, cle: CLE_SNAPSHOT })
  vi.mocked(recordAttempt).mockImplementation(() => undefined)

  candidatFindUnique.mockImplementation(async () => ({ id: CANDIDAT_ID }))
  offreFindUnique.mockImplementation(async () => ({ statut: 'publiee' }))

  // Lecture de contrôle : findUnique = lecture GLOBALE (admin / retrait),
  // findFirst = lecture SCOPÉE au recruteur de l'offre.
  candidatureFindUnique.mockImplementation(async (args) => {
    const ligne = base.ligne
    if (ligne === null || ligne.id !== args.where.id) return null
    return { statut: ligne.statut, offreId: ligne.offreId, candidatId: ligne.candidatId }
  })
  candidatureFindFirst.mockImplementation(async (args) => {
    const ligne = base.ligne
    if (ligne === null || ligne.id !== args.where.id) return null
    const scope = args.where.offre
    if (scope !== undefined && scope.entreprise.userId !== ligne.offreUserId) return null
    return { statut: ligne.statut, offreId: ligne.offreId, candidatId: ligne.candidatId }
  })

  // CAS réel : verdict déduit du `where` posé sur la ligne de `base`.
  candidatureUpdateMany.mockImplementation(async (args) => ({
    count: base.ligne !== null && casEquivaut(args.where, base.ligne) ? 1 : 0,
  }))
  candidatureCreate.mockImplementation(async (args) => ({
    id: CANDIDATURE_ID,
    ...args.data,
  }))
  auditCandidatureCreate.mockImplementation(async (args) => args.data)

  // $transaction : OMBRE committée seulement si le callback se termine.
  transaction.mockImplementation(async (fn) => {
    ombre = { statut: null, creations: [], audits: [] }
    const sortie = await fn(TX)
    if (ombre.statut !== null && base.ligne !== null) {
      base.ligne = { ...base.ligne, statut: ombre.statut }
    }
    base.creations.push(...ombre.creations)
    base.audits.push(...ombre.audits)
    return sortie
  })
})

// ─── CAS 1 — mass-assignment : le payload hostile n'écrit JAMAIS l'audit ────

describe('cas 1 — mass-assignment : audit et ligne échappent au payload', () => {
  it('postulerOffre : clés hostiles ignorées, création en liste blanche, audit `creation` de la SESSION', async () => {
    const form = formOf({
      ...FORM_POSTULATION,
      acteurId: '999',
      action: 'consultation',
      candidatureId: '999',
      audit: 'injection',
      statut: 'acceptee',
      candidatId: '999',
      offreId: '999',
      cvPath: 'cvs/vole.pdf',
    })

    await attendRedirection(postulerOffre(form), `/offres/${SLUG}/postuler?maj=envoyee`)

    // Liste blanche EXACTE du create : 4 clés, pas une de plus, et surtout
    // JAMAIS `statut` (seul le CREATE écrit `envoyee`, jamais une cible).
    expect(Object.keys(dataCreation() ?? {}).sort()).toEqual([
      'candidatId',
      'cvPath',
      'lettreMotivation',
      'offreId',
    ])
    expect(dataCreation()).toEqual({
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
      lettreMotivation: LETTRE,
      cvPath: CLE_SNAPSHOT,
    })

    // L'audit vient de la SESSION et des constantes du module, jamais du
    // formulaire : `action` forgeée « consultation » ignorée, `candidatureId`
    // forgeé ignoré, `acteurId` forgeé ignoré.
    expect(base.audits).toHaveLength(1)
    expect(base.audits[0]).toEqual({
      candidatureId: CANDIDATURE_ID,
      acteurId: USER_ID,
      action: ACTION_AUDIT_CREATION,
      ancienStatut: null,
      nouveauStatut: 'envoyee',
    })
    expect(base.creations).toHaveLength(1)
    expect(candidatureEnvoyee).toHaveBeenCalledWith({
      candidatureId: CANDIDATURE_ID,
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    })
  })

  it('retirerCandidature : `candidatureId`/`action`/`acteurId` hostiles ignorés (champ lu = `id`)', async () => {
    const form = formOf({
      id: String(CANDIDATURE_ID),
      candidatureId: '123456',
      action: 'creation',
      acteurId: '999',
      audit: 'injection',
      statut: 'acceptee',
    })

    await attendRedirection(retirerCandidature(form), '/candidat/candidatures?maj=retiree')

    // Le CAS porte l'`id` DU FORMULAIRE (champ caché), pas `candidatureId`.
    expect(whereUpdateMany()).toEqual({
      id: CANDIDATURE_ID,
      candidatId: CANDIDAT_ID,
      statut: { notIn: [...STATUTS_TERMINAUX] },
    })
    expect(base.audits).toHaveLength(1)
    expect(base.audits[0]).toEqual({
      candidatureId: CANDIDATURE_ID,
      acteurId: USER_ID,
      action: ACTION_AUDIT_RETRAIT,
      ancienStatut: 'envoyee',
      nouveauStatut: 'retiree',
    })
    expect(base.ligne?.statut).toBe('retiree')
  })

  it('changerStatutCandidature : `statut`/`candidatId`/`action` hostiles ignorés — seule la clé `vers` décide', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    const form = formOf({
      id: String(CANDIDATURE_ID),
      vers: 'consultee',
      statut: 'acceptee',
      candidatId: '999',
      action: 'consultation',
      acteurId: '999',
    })

    await attendRedirection(changerStatutCandidature(form), '/recruteur/candidatures?maj=statut')

    expect(base.ligne?.statut).toBe('consultee')
    expect(base.audits).toHaveLength(1)
    expect(base.audits[0]).toEqual({
      candidatureId: CANDIDATURE_ID,
      acteurId: USER_ID,
      action: ACTION_AUDIT_TRANSITION,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
    })
  })

  it("cible posée dans un champ `statut` (et non `vers`) : refus AVANT toute lecture", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })

    await attendRedirection(
      changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), statut: 'acceptee' })),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })

  it('schémas `.strict()` : toute clé inconnue fait ÉCHOUER le parse (postulation ET changement de statut)', async () => {
    expect(schemaPostulation.safeParse({ sourceCv: 'profil' }).success).toBe(true)
    expect(
      schemaPostulation.safeParse({ sourceCv: 'profil', statut: 'acceptee', cvPath: 'x' })
        .success,
    ).toBe(false)

    expect(schemaChangementStatut.safeParse({ statut: 'consultee' }).success).toBe(true)
    expect(
      schemaChangementStatut.safeParse({ statut: 'consultee', candidatId: 1 }).success,
    ).toBe(false)
    expect(
      schemaChangementStatut.safeParse({ statut: 'consultee', acteurId: 1, action: 'creation' })
        .success,
    ).toBe(false)
  })
})

// ─── CAS 2 — transitions hors matrice : refus verrouillé ────────────────────

describe('cas 2 — matrice des transitions : seul le droit décide', () => {
  it("littéraux de la source verrouillés : consultee→entretien, envoyee→acceptee/refusee, cible `envoyee`, terminal→X", () => {
    for (const acteur of ['recruteur', 'admin'] as const) {
      expect(peutTransiter('consultee', 'entretien', acteur)).toBe(false)
      expect(peutTransiter('envoyee', 'acceptee', acteur)).toBe(false)
      expect(peutTransiter('envoyee', 'refusee', acteur)).toBe(false)
      // `envoyee` n'est JAMAIS une cible de transition : seul le CREATE
      // l'écrit (colonne @default(envoyee)).
      expect(peutTransiter('consultee', 'envoyee', acteur)).toBe(false)
      expect(peutTransiter('preselectionnee', 'envoyee', acteur)).toBe(false)
      // `retiree` est absolument terminal.
      expect(peutTransiter('retiree', 'preselectionnee', acteur)).toBe(false)
      expect(peutTransiter('retiree', 'acceptee', acteur)).toBe(false)
    }
    // Depuis `acceptee`, le recruteur ne garde que la réouverture.
    expect(peutTransiter('acceptee', 'entretien', 'recruteur')).toBe(false)
    expect(peutTransiter('acceptee', 'retiree', 'recruteur')).toBe(false)
  })

  it("parcours exhaustif 7 sources × 7 cibles × 2 acteurs : le verdict de l'action SUIVRA la matrice, jamais autre chose", async () => {
    for (const acteur of ['recruteur', 'admin'] as const) {
      vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: acteur })
      for (const depuis of STATUTS) {
        for (const vers of STATUTS) {
          ligneDeBase().statut = depuis
          base.audits.length = 0
          candidatureUpdateMany.mockClear()
          vi.mocked(statutChange).mockClear()

          const attendu = peutTransiter(depuis, vers, acteur)
          const action = changerStatutCandidature(
            formOf({ id: String(CANDIDATURE_ID), vers }),
          )

          if (attendu) {
            await attendRedirection(action, '/recruteur/candidatures?maj=statut')
            expect(ligneDeBase().statut).toBe(vers)
            expect(base.audits).toHaveLength(1)
            expect(base.audits[0]).toMatchObject({
              action: ACTION_AUDIT_TRANSITION,
              acteurId: USER_ID,
              ancienStatut: depuis,
              nouveauStatut: vers,
            })
          } else {
            await attendRedirection(action, '/recruteur/candidatures?erreur=transition')
            // Refus AVANT le CAS : aucune écriture n'est même tentée.
            expect(candidatureUpdateMany).not.toHaveBeenCalled()
            expect(ligneDeBase().statut).toBe(depuis)
            expect(base.audits).toHaveLength(0)
            expect(statutChange).not.toHaveBeenCalled()
          }
        }
      }
    }
  })

  it('cas cités par la spec : envoyee→acceptee, envoyee→refusee, consultee→entretien, terminal→X refusés sans CAS ni audit', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    const cas: Array<{ depuis: StatutCandidature; vers: StatutCandidature }> = [
      { depuis: 'envoyee', vers: 'acceptee' },
      { depuis: 'envoyee', vers: 'refusee' },
      { depuis: 'consultee', vers: 'entretien' },
      { depuis: 'acceptee', vers: 'entretien' },
      { depuis: 'retiree', vers: 'preselectionnee' },
    ]

    for (const { depuis, vers } of cas) {
      ligneDeBase().statut = depuis
      base.audits.length = 0
      candidatureUpdateMany.mockClear()

      await attendRedirection(
        changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), vers })),
        '/recruteur/candidatures?erreur=transition',
      )

      expect(candidatureUpdateMany).not.toHaveBeenCalled()
      expect(base.audits).toHaveLength(0)
      expect(ligneDeBase().statut).toBe(depuis)
    }
  })
})

// ─── CAS 3 — l'audit n'existe que si la mutation existe ─────────────────────

describe("cas 3 — audit conditionnel au compare-and-set", () => {
  it('double soumission : le second CAS ne trouve plus la source → UNE SEULE ligne `transition`', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    // Les deux requêtes lisent le même statut source (simulation de deux
    // clics simultanés) : c'est le CAS qui départage, pas la lecture.
    candidatureFindFirst.mockImplementation(async () => ({
      statut: 'envoyee',
      offreId: OFFRE_ID,
      candidatId: CANDIDAT_ID,
    }))

    await attendRedirection(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
      '/recruteur/candidatures?maj=statut',
    )
    await attendRedirection(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureUpdateMany).toHaveBeenCalledTimes(2)
    expect(base.audits).toHaveLength(1)
    expect(base.ligne?.statut).toBe('consultee')
    expect(statutChange).toHaveBeenCalledTimes(1)
  })

  it("échec d'audit dans la $transaction : rollback OBSERVÉ (statut intact, zéro trace), erreur propagée, jamais de redirect", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    auditCandidatureCreate.mockImplementation(async () => {
      throw new Error('AUDIT_DOWN')
    })

    await symptome(changerStatutCandidature(formOf(FORM_TRANSITION)))

    // Le CAS avait touché la ligne DANS l'ombre : le rollback de la
    // transaction l'annule — « jamais de mutation sans trace ».
    expect(candidatureUpdateMany).toHaveBeenCalledTimes(1)
    expect(base.ligne?.statut).toBe('envoyee')
    expect(base.audits).toHaveLength(0)
    expect(redirect).not.toHaveBeenCalled()
    expect(statutChange).not.toHaveBeenCalled()
    await expect(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
    ).rejects.toThrow('AUDIT_DOWN')
  })

  it("postulation : échec d'audit → AUCUNE candidature committée, snapshot annulé, seau intact", async () => {
    auditCandidatureCreate.mockImplementation(async () => {
      throw new Error('AUDIT_DOWN')
    })

    const verdict = await symptome(postulerOffre(formOf(FORM_POSTULATION)))

    expect(verdict).toBe('AUDIT_DOWN')
    expect(base.creations).toHaveLength(0)
    expect(base.audits).toHaveLength(0)
    expect(annulerSnapshotCv).toHaveBeenCalledWith(CLE_SNAPSHOT)
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(candidatureEnvoyee).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})

// ─── CAS 4 — acteur = session, périmètre = jointure DANS le where ───────────

describe('cas 4 — scoping recruteur : le périmètre voyage dans la requête', () => {
  it("recruteur A sur la candidature de l'offre du recruteur B : 404, AUCUNE écriture et AUCUNE audit", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    // La ligne appartient à une autre entreprise (userId 8 ≠ 42).
    base.ligne = { ...ligneDeBase(), offreUserId: 8 }

    await attend404(changerStatutCandidature(formOf(FORM_TRANSITION)))

    expect(candidatureFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CANDIDATURE_ID, offre: { entreprise: { userId: USER_ID } } },
      }),
    )
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
    expect(statutChange).not.toHaveBeenCalled()
  })

  it('la même ligne vue par l ADMIN (lecture globale) reste soumise à la matrice — pas de passe-droit', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'admin' })
    base.ligne = { ...ligneDeBase(), statut: 'retiree', offreUserId: 8 }

    await attendRedirection(
      changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), vers: 'preselectionnee' })),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CANDIDATURE_ID } }),
    )
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })
})

// ─── CAS 5 — candidat ne change jamais, recruteur ne retire jamais ──────────

describe('cas 5 — rôles : les gardes meurent AVANT toute lecture', () => {
  it("candidat sur changerStatutCandidature : verifyRole('recruteur','admin') refuse — aucune lecture, aucune écriture", async () => {
    vi.mocked(verifyRole).mockRejectedValue(new Error('REDIRECT:/unauthorized'))

    const verdict = await symptome(changerStatutCandidature(formOf(FORM_TRANSITION)))

    expect(verdict).toBe('REDIRECT:/unauthorized')
    expect(verifyRole).toHaveBeenCalledWith('recruteur', 'admin')
    expect(candidatureFindFirst).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
    expect(notFound).not.toHaveBeenCalled()
  })

  it("recruteur sur retirerCandidature : verifyRole('candidat') refuse — aucune lecture, aucune écriture", async () => {
    vi.mocked(verifyRole).mockRejectedValue(new Error('REDIRECT:/unauthorized'))

    const verdict = await symptome(retirerCandidature(formOf(FORM_RETRAIT)))

    expect(verdict).toBe('REDIRECT:/unauthorized')
    expect(verifyRole).toHaveBeenCalledWith('candidat')
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })

  it('retrait avec un compte SANS profil candidat (garde contournée) : 404 strict, aucune écriture', async () => {
    // Simule un garde de rôle contourné : la session porte le rôle recruteur.
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    candidatFindUnique.mockImplementation(async () => null)

    await attend404(retirerCandidature(formOf(FORM_RETRAIT)))

    expect(candidatureFindUnique).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
    expect(candidatureRetiree).not.toHaveBeenCalled()
  })

  it('retrait sur la ligne d’un AUTRE candidat (garde contournée) : 404 strict, CAS jamais tenté', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
    base.ligne = { ...ligneDeBase(), candidatId: 999 }

    await attend404(retirerCandidature(formOf(FORM_RETRAIT)))

    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })

  it("changerStatut avec une session candidat (garde contournée) : c'est la MATRICE qui refuse", async () => {
    // Garde contournée + ligne lue (findUnique non scopé côté « acteur »
    // non recruteur) : la défense restante est la matrice, acteur-aware.
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'candidat' })

    await attendRedirection(
      changerStatutCandidature(formOf(FORM_TRANSITION)),
      '/recruteur/candidatures?erreur=transition',
    )

    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
    expect(base.ligne?.statut).toBe('envoyee')
  })
})

// ─── CAS 6 — oracle P2-1 : brouillon ≡ slug absent ──────────────────────────

describe("cas 6 — aucune fuite d'existence sur les offres", () => {
  it('offre BROUILLON : notFound() STRICTEMENT identique au slug inexistant, seau intact', async () => {
    vi.mocked(lireOffrePublique).mockResolvedValue(null)
    offreFindUnique.mockImplementation(async () => null)
    const symboleSlugAbsent = await symptome(postulerOffre(formOf(FORM_POSTULATION)))
    const appelsNotFound = vi.mocked(notFound).mock.calls.length
    const appelsRedirect = vi.mocked(redirect).mock.calls.length

    vi.mocked(lireOffrePublique).mockResolvedValue(null)
    offreFindUnique.mockImplementation(async () => ({ statut: 'brouillon' }))
    const symboleBrouillon = await symptome(postulerOffre(formOf(FORM_POSTULATION)))

    expect(symboleSlugAbsent).toBe('NOT_FOUND')
    expect(symboleBrouillon).toBe(symboleSlugAbsent)
    expect(vi.mocked(notFound).mock.calls.length - appelsNotFound).toBe(1)
    // Aucun `?erreur=` distinct dans les DEUX cas (aucun oracle).
    expect(vi.mocked(redirect).mock.calls.length).toBe(appelsRedirect)
    expect(candidatureCreate).not.toHaveBeenCalled()
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(preparerSnapshotCv).not.toHaveBeenCalled()

    // Ordre imposé : rôle → seau → offre. L'étape « candidat » n'est JAMAIS
    // atteinte (le 404 naît à l'offre), et rien n'est écrit.
    const ordreRole = vi.mocked(verifyRole).mock.invocationCallOrder[0] ?? 0
    const ordreSeau = vi.mocked(checkRateLimit).mock.invocationCallOrder[0] ?? 0
    const ordreOffre = vi.mocked(lireOffrePublique).mock.invocationCallOrder[0] ?? 0
    expect(ordreSeau).toBeGreaterThan(ordreRole)
    expect(ordreOffre).toBeGreaterThan(ordreSeau)
    expect(candidatFindUnique).not.toHaveBeenCalled()
    // Politique M7 : 10/h par COMPTE (jamais par offre).
    expect(checkRateLimit).toHaveBeenCalledWith(
      CLE_SEAU,
      CANDIDATURES_MAX_PAR_COMPTE,
      CANDIDATURES_WINDOW_MS,
    )
  })

  it("slugs hostiles (query injection, ancre, hôte externe, legacy, id à zéro) : 404 AVANT le seau et toute lecture", async () => {
    const slugsHostiles = [
      'developpeur-back-end-42?maj=envoyee',
      'developpeur-back-end-42?erreur=doublon',
      'developpeur-back-end-42#fragment',
      '//evil.example/offre-42',
      'developpeur-back-end-42/../../../etc',
      'OFFRE-42',
      'developpeur-back-end-0',
      '42',
      '',
    ]

    for (const slug of slugsHostiles) {
      const form = formOf({ ...FORM_POSTULATION, slug })
      expect(await symptome(postulerOffre(form))).toBe('NOT_FOUND')
    }

    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(lireOffrePublique).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(candidatureCreate).not.toHaveBeenCalled()
    // Surtout : AUCUNE redirection ne peut porter un hôte ou une query forgée.
    expect(redirect).not.toHaveBeenCalled()
  })
})

// ─── CAS 7 — marquerConsultee : garde, scoping, audit best-effort ───────────

describe('cas 7 — marquerConsultee : jamais de transition sans droit ni trace', () => {
  it("visiteur sans session : verifyRole redirige → AUCUN updateMany, AUCUNE audit", async () => {
    vi.mocked(verifyRole).mockRejectedValue(new Error('REDIRECT:/login'))

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(verifyRole).toHaveBeenCalledWith('recruteur', 'admin')
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rôle `candidat` : verifyRole('recruteur','admin') refuse → aucune écriture", async () => {
    vi.mocked(verifyRole).mockRejectedValue(new Error('REDIRECT:/unauthorized'))

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })

  it("recruteur d'une autre entreprise : le scoping voyage DANS le where du CAS → count 0, AUCUNE audit, statut inchangé", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    base.ligne = { ...ligneDeBase(), offreUserId: 8 }

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(candidatureUpdateMany).toHaveBeenCalledTimes(1)
    expect(whereUpdateMany()).toEqual({
      id: CANDIDATURE_ID,
      statut: 'envoyee',
      offre: { entreprise: { userId: USER_ID } },
    })
    expect(base.audits).toHaveLength(0)
    expect(base.ligne?.statut).toBe('envoyee')
  })

  it('candidature déjà `preselectionnee` : CAS `statut: envoyee` à zéro → AUCUNE audit parasite', async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    base.ligne = { ...ligneDeBase(), statut: 'preselectionnee' }

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(base.audits).toHaveLength(0)
    expect(base.ligne?.statut).toBe('preselectionnee')
  })

  it("échec d'audit : best-effort ATOMIQUE — rollback observé, aucune exception propagée", async () => {
    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    auditCandidatureCreate.mockImplementation(async () => {
      throw new Error('AUDIT_DOWN')
    })

    await expect(marquerConsultee(CANDIDATURE_ID)).resolves.toBeUndefined()

    expect(base.ligne?.statut).toBe('envoyee')
    expect(base.audits).toHaveLength(0)
  })
})

// ─── CAS 8 — retrait atomique ───────────────────────────────────────────────

describe('cas 8 — retrait : CAS périmètre + terminaux, atomique avec son audit', () => {
  it('ligne TERMINALE (`acceptee`) : CAS à zéro → ?erreur=retrait, AUCUNE ligne `retrait`, AUCUNE annulation de snapshot', async () => {
    base.ligne = { ...ligneDeBase(), statut: 'acceptee' }

    await attendRedirection(
      retirerCandidature(formOf(FORM_RETRAIT)),
      '/candidat/candidatures?erreur=retrait',
    )

    expect(whereUpdateMany()).toEqual({
      id: CANDIDATURE_ID,
      candidatId: CANDIDAT_ID,
      statut: { notIn: [...STATUTS_TERMINAUX] },
    })
    expect(ligneDeBase().statut).toBe('acceptee')
    expect(base.audits).toHaveLength(0)
    expect(annulerSnapshotCv).not.toHaveBeenCalled()
    expect(candidatureRetiree).not.toHaveBeenCalled()
  })

  it('ligne `preselectionnee` : retrait AUTORISÉ par la matrice candidat → retiree + audit `retrait` atomique', async () => {
    // La matrice source autorise `candidat: ['retiree']` depuis tout statut
    // non terminal — le retrait n'est refusé que pour les TERMINAUX.
    base.ligne = { ...ligneDeBase(), statut: 'preselectionnee' }

    await attendRedirection(retirerCandidature(formOf(FORM_RETRAIT)), '/candidat/candidatures?maj=retiree')

    expect(ligneDeBase().statut).toBe('retiree')
    expect(base.audits).toHaveLength(1)
    expect(base.audits[0]).toEqual({
      candidatureId: CANDIDATURE_ID,
      acteurId: USER_ID,
      action: ACTION_AUDIT_RETRAIT,
      ancienStatut: 'preselectionnee',
      nouveauStatut: 'retiree',
    })
  })

  it("doctrine 404 : ligne d'autrui, ligne absente et id mal formé partagent le MÊME symptôme (aucun ?erreur= distinct)", async () => {
    base.ligne = { ...ligneDeBase(), candidatId: 999 }
    const symboleAutrui = await symptome(retirerCandidature(formOf(FORM_RETRAIT)))

    base.ligne = null
    const symboleAbsente = await symptome(retirerCandidature(formOf(FORM_RETRAIT)))

    const symboleMalForme = await symptome(
      retirerCandidature(formOf({ id: '42.5' })),
    )
    const symboleZero = await symptome(retirerCandidature(formOf({ id: '0' })))
    const symboleNegatif = await symptome(retirerCandidature(formOf({ id: '-1' })))
    const symboleEspace = await symptome(retirerCandidature(formOf({ id: ' 900' })))

    expect(symboleAutrui).toBe('NOT_FOUND')
    expect(symboleAbsente).toBe('NOT_FOUND')
    expect(symboleMalForme).toBe('NOT_FOUND')
    expect(symboleZero).toBe('NOT_FOUND')
    expect(symboleNegatif).toBe('NOT_FOUND')
    expect(symboleEspace).toBe('NOT_FOUND')
    expect(redirect).not.toHaveBeenCalled()
    expect(candidatureUpdateMany).not.toHaveBeenCalled()
    expect(base.audits).toHaveLength(0)
  })
})

// ─── Transverse — aucun texte UI inventé, aucune redirection ouverte ────────

describe("transverse — URL de retour contrôlées par la source des libellés", () => {
  it("chaque redirection est RELATIVE et chaque clé ?erreur=/?maj= existe dans candidatures-labels.ts", async () => {
    const urls: string[] = []

    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, retryAfterMs: 0 })
    urls.push(await capturerRedirection(postulerOffre(formOf(FORM_POSTULATION))))
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, retryAfterMs: 0 })

    urls.push(
      await capturerRedirection(postulerOffre(formOf({ slug: SLUG, sourceCv: 'inconnue' }))),
    )

    base.ligne = { ...ligneDeBase(), statut: 'acceptee' }
    urls.push(await capturerRedirection(retirerCandidature(formOf(FORM_RETRAIT))))

    base.ligne = { ...ligneDeBase(), statut: 'envoyee' }
    urls.push(await capturerRedirection(retirerCandidature(formOf(FORM_RETRAIT))))

    vi.mocked(verifyRole).mockResolvedValue({ userId: USER_ID, role: 'recruteur' })
    urls.push(
      await capturerRedirection(
        changerStatutCandidature(formOf({ id: String(CANDIDATURE_ID), vers: 'envoyee' })),
      ),
    )
    urls.push(await capturerRedirection(changerStatutCandidature(formOf(FORM_TRANSITION))))
    urls.push(await capturerRedirection(postulerOffre(formOf(FORM_POSTULATION))))

    expect(new Set(urls).size).toBeGreaterThanOrEqual(6)
    for (const url of urls) {
      // Aucune redirection ouverte : chemin relatif, jamais d'hôte ni `//`.
      expect(url.startsWith('/')).toBe(true)
      expect(url.startsWith('//')).toBe(false)

      const erreur = parametre(url, 'erreur')
      if (erreur !== null) {
        // Fail-closed : la clé DOIT exister dans MESSAGES_ERREUR_CANDIDATURE
        // (une clé inconnue n'affiche rien — jamais de texte non contrôlé).
        expect(messageErreurCandidature(erreur)).toEqual(expect.any(String))
      }

      const maj = parametre(url, 'maj')
      if (maj !== null) {
        // `statut` est la seule clé SANS bandeau (documenté, fail-closed) ;
        // `envoyee` et `retiree` portent le texte contrôlé de la source.
        if (maj === 'statut') {
          expect(messageMajCandidature(maj)).toBeNull()
        } else {
          expect(messageMajCandidature(maj)).toEqual(expect.any(String))
        }
      }
    }
  })
})
