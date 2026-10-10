import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ACTION_AUDIT_CONSULTATION,
  ACTION_AUDIT_CREATION,
  ACTION_AUDIT_RETRAIT,
  ACTION_AUDIT_TRANSITION,
  journaliserCandidature,
  type ActionAuditCandidature,
} from '@/lib/candidature-audit'

// ─── Tests du module d’audit des candidatures (M7 / V3-I) ────────────────────
// Verrous :
// 1. les 4 constantes ont EXACTEMENT les valeurs attendues et tiennent dans
//    la colonne `action` VarChar(50) ;
// 2. le type union en dérive (aucune 5e nature, ni nature fantôme) ;
// 3. `journaliserCandidature` écrit la payload COMPLÈTE (statuts explicitement
//    `null` quand il n’y en a pas — jamais `undefined` laissé au hasard) ;
// 4. aucune erreur n’est rattrapée ici : la politique d’échec (fail-closed ou
//    best-effort) appartient à l’appelant.
// Seul le client Prisma est simulé : le module n’importe AUCUN module
// applicatif (uniquement des `type`), sa logique d’écriture tourne pour de vrai.
// ---------------------------------------------------------------------------

/** Écriture simulée de `db.auditCandidature.create`. */
const auditCandidatureCreate = vi.fn()

/**
 * Client factice TYPOÉ : seule l’opération utilisée par le module existe.
 * L’appelant réel passe soit `prisma`, soit le client `tx` de sa propre
 * `$transaction` — le module se contente de l’utiliser tel quel.
 */
function clientAudit(): PrismaClient {
  return { auditCandidature: { create: auditCandidatureCreate } } as unknown as PrismaClient
}

const CANDIDATURE_ID = 900
const ACTEUR_ID = 42

/** Liste de référence : la runtime et le type doivent coïncider avec elle. */
const NATURES_REFERENCE = ['creation', 'retrait', 'transition', 'consultation'] as const
type NatureReference = (typeof NATURES_REFERENCE)[number]

/** Contrôle compile-time : les deux unions se contiennent mutuellement. */
const UNION_EXACTE: ActionAuditCandidature extends NatureReference
  ? NatureReference extends ActionAuditCandidature
    ? true
    : false
  : false = true

beforeEach(() => {
  vi.clearAllMocks()
})

describe('constantes de nature', () => {
  it("a EXACTEMENT 'creation' | 'retrait' | 'transition' | 'consultation', chacune ≤ 50 caractères", () => {
    const natures = [
      ACTION_AUDIT_CREATION,
      ACTION_AUDIT_RETRAIT,
      ACTION_AUDIT_TRANSITION,
      ACTION_AUDIT_CONSULTATION,
    ]

    expect(natures).toEqual([...NATURES_REFERENCE])
    // Colonne `action` VarChar(50) : une valeur plus longue serait refusée ou
    // tronquée en base.
    for (const action of natures) {
      expect(action.length).toBeLessThanOrEqual(50)
    }
    // Contrôle de TYPE : la union exportée et la référence coïncident — ni 5e
    // nature, ni valeur dérivée absente de l’objet `as const`.
    expect(UNION_EXACTE).toBe(true)
  })
})

describe('journaliserCandidature', () => {
  it('écrit la payload complète de `creation` puis `consultation` (statuts null)', async () => {
    await journaliserCandidature(clientAudit(), {
      candidatureId: CANDIDATURE_ID,
      acteurId: ACTEUR_ID,
      action: ACTION_AUDIT_CREATION,
      ancienStatut: null,
      nouveauStatut: 'envoyee',
    })
    await journaliserCandidature(clientAudit(), {
      candidatureId: CANDIDATURE_ID,
      acteurId: ACTEUR_ID,
      action: ACTION_AUDIT_CONSULTATION,
    })

    expect(auditCandidatureCreate).toHaveBeenCalledTimes(2)
    expect(auditCandidatureCreate).toHaveBeenNthCalledWith(1, {
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: ACTEUR_ID,
        action: 'creation',
        ancienStatut: null,
        nouveauStatut: 'envoyee',
      },
    })
    // Omettre les statuts équivaut à `null` : la colonne est EXPLICITEMENT
    // écrite (jamais `undefined`), ni oubliée ni devinée.
    expect(auditCandidatureCreate).toHaveBeenNthCalledWith(2, {
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: ACTEUR_ID,
        action: 'consultation',
        ancienStatut: null,
        nouveauStatut: null,
      },
    })
  })

  it('conserve les statuts réels de `retrait` et `transition`', async () => {
    await journaliserCandidature(clientAudit(), {
      candidatureId: CANDIDATURE_ID,
      acteurId: ACTEUR_ID,
      action: ACTION_AUDIT_RETRAIT,
      ancienStatut: 'consultee',
      nouveauStatut: 'retiree',
    })
    await journaliserCandidature(clientAudit(), {
      candidatureId: CANDIDATURE_ID,
      acteurId: ACTEUR_ID,
      action: ACTION_AUDIT_TRANSITION,
      ancienStatut: 'envoyee',
      nouveauStatut: 'consultee',
    })

    expect(auditCandidatureCreate).toHaveBeenNthCalledWith(1, {
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: ACTEUR_ID,
        action: 'retrait',
        ancienStatut: 'consultee',
        nouveauStatut: 'retiree',
      },
    })
    expect(auditCandidatureCreate).toHaveBeenNthCalledWith(2, {
      data: {
        candidatureId: CANDIDATURE_ID,
        acteurId: ACTEUR_ID,
        action: 'transition',
        ancienStatut: 'envoyee',
        nouveauStatut: 'consultee',
      },
    })
  })

  it("propage l’erreur du client (aucun rattrapage dans le module)", async () => {
    auditCandidatureCreate.mockRejectedValueOnce(new Error('DB_DOWN'))

    await expect(
      journaliserCandidature(clientAudit(), {
        candidatureId: CANDIDATURE_ID,
        acteurId: ACTEUR_ID,
        action: ACTION_AUDIT_CREATION,
        ancienStatut: null,
        nouveauStatut: 'envoyee',
      }),
    ).rejects.toThrow('DB_DOWN')
  })
})
