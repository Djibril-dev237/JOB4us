import { describe, expect, it } from 'vitest'

import { TYPE_NOTIFICATIONS } from './notifications-labels'
import {
  schemaCurseurNotifications,
  schemaMarquerNotificationLu,
  schemaPreferenceEmailType,
  schemaReglageResumeQuotidien,
  schemaSupprimerNotification,
  schemaToutMarquerLu,
} from './notifications-schemas'

// ─── Contrats des schémas M9 ─────────────────────────────────────────────────
// Verrouillent la FORME uniquement (l'autorisation et l'écriture appartiennent
// aux actions) : catalogue de 9 types emprunté à notifications-labels (les 9
// acceptées, toute valeur hors liste rejetée), curseur ISO-8601 avec offset +
// id entier positif borné, booléens STRICTS (aucune coercition : « true » et
// 1 rejetés), ids de notification entiers stricts (0, -1, 1.5 et chaînes
// rejetés), `.strict()` contre les clés injectées — y compris sur l'objet vide
// « tout lire ».
// ---------------------------------------------------------------------------

describe('schemaPreferenceEmailType — catalogue fermé', () => {
  it.each([...TYPE_NOTIFICATIONS])('accepte le type du catalogue « %s »', (type) => {
    const payload = { type, emailActive: true }
    expect(schemaPreferenceEmailType.parse(payload)).toEqual(payload)
  })

  it.each(['inconnu', 'Systeme', 'SIGNALEMENT_RECU', 'notifications', '', 9, null])(
    'rejette le type hors catalogue « %j »',
    (type) => {
      expect(schemaPreferenceEmailType.safeParse({ type, emailActive: true }).success).toBe(false)
    },
  )

  it.each([true, false])('accepte emailActive = %s (booléen strict)', (emailActive) => {
    expect(schemaPreferenceEmailType.parse({ type: 'systeme', emailActive }).emailActive).toBe(
      emailActive,
    )
  })

  it.each(['true', 'false', 1, 0, 'on', null])(
    'rejette emailActive = %j (booléen strict, aucune coercition)',
    (emailActive) => {
      expect(
        schemaPreferenceEmailType.safeParse({ type: 'systeme', emailActive }).success,
      ).toBe(false)
    },
  )

  it('rejette un type ou un emailActive absent', () => {
    expect(schemaPreferenceEmailType.safeParse({ emailActive: true }).success).toBe(false)
    expect(schemaPreferenceEmailType.safeParse({ type: 'systeme' }).success).toBe(false)
  })
})

describe('schemaReglageResumeQuotidien — booléen strict', () => {
  it.each([true, false])('accepte resumeQuotidien = %s', (resumeQuotidien) => {
    expect(schemaReglageResumeQuotidien.parse({ resumeQuotidien })).toEqual({ resumeQuotidien })
  })

  it.each(['true', 'false', 1, 0, 'on', null])(
    'rejette resumeQuotidien = %j (booléen strict, aucune coercition)',
    (resumeQuotidien) => {
      expect(schemaReglageResumeQuotidien.safeParse({ resumeQuotidien }).success).toBe(false)
    },
  )

  it('rejette l’absence de resumeQuotidien (le champ est requis)', () => {
    expect(schemaReglageResumeQuotidien.safeParse({}).success).toBe(false)
  })
})

describe('schemaCurseurNotifications — curseur ISO-8601 + id', () => {
  it('accepte un curseur Z et un curseur avec offset, identique en retour', () => {
    expect(
      schemaCurseurNotifications.parse({ curseur: ['2026-01-31T12:00:00Z', 42] }).curseur,
    ).toEqual(['2026-01-31T12:00:00Z', 42])
    expect(
      schemaCurseurNotifications.safeParse({
        curseur: ['2026-01-31T12:00:00+01:00', 1],
      }).success,
    ).toBe(true)
  })

  it('accepte l’absence de curseur (premier chargement)', () => {
    expect(schemaCurseurNotifications.parse({})).toEqual({})
  })

  it.each(['31/01/2026', '2026-01-31', 'hier', '2026-01-31T12:00:00'])(
    'rejette la date mal formée ou sans offset « %s »',
    (createdAt) => {
      expect(schemaCurseurNotifications.safeParse({ curseur: [createdAt, 1] }).success).toBe(false)
    },
  )

  it.each([0, -1, 1.5, '42', null, Number.NaN])(
    'rejette l’id « %j » du curseur (entier positif attendu)',
    (id) => {
      expect(
        schemaCurseurNotifications.safeParse({ curseur: ['2026-01-31T12:00:00Z', id] }).success,
      ).toBe(false)
    },
  )

  it('applique bornage Int32 à l’id du curseur (2^31 : Prisma lèverait hors gestion)', () => {
    expect(
      schemaCurseurNotifications.safeParse({
        curseur: ['2026-01-31T12:00:00Z', 2_147_483_648],
      }).success,
    ).toBe(false)
    expect(
      schemaCurseurNotifications.safeParse({
        curseur: ['2026-01-31T12:00:00Z', 2_147_483_647],
      }).success,
    ).toBe(true)
  })

  it.each([
    ['2026-01-31T12:00:00Z'],
    ['2026-01-31T12:00:00Z', 1, 'trop'],
    { createdAt: '2026-01-31T12:00:00Z', id: 1 },
    '2026-01-31T12:00:00Z',
  ])('rejette un curseur qui n’est pas le tuple [createdAt, id] « %j »', (curseur) => {
    expect(schemaCurseurNotifications.safeParse({ curseur }).success).toBe(false)
  })
})

describe('schemas d’identifiants — entiers positifs bornés', () => {
  it.each([
    ['schemaMarquerNotificationLu', schemaMarquerNotificationLu, { notificationId: 1 }],
    ['schemaSupprimerNotification', schemaSupprimerNotification, { notificationId: 7 }],
  ] as const)('%s accepte la charge valide', (_nom, schema, valide) => {
    expect(schema.parse(valide)).toEqual(valide)
  })

  it.each([
    ['schemaMarquerNotificationLu', schemaMarquerNotificationLu],
    ['schemaSupprimerNotification', schemaSupprimerNotification],
  ] as const)('%s rejette 0, -1, 1.5, la chaîne « 7 », null et l’Int32 débordant', (_nom, schema) => {
    for (const notificationId of [0, -1, 1.5, '7', null, 2_147_483_648]) {
      expect(schema.safeParse({ notificationId }).success).toBe(false)
    }
    expect(schema.safeParse({ notificationId: 2_147_483_647 }).success).toBe(true)
  })
})

describe('schemaToutMarquerLu — objet vide strict', () => {
  it('accepte un payload vide', () => {
    expect(schemaToutMarquerLu.parse({})).toEqual({})
  })

  it.each([
    ['notificationId', 7],
    ['destinataireId', 7],
    ['lu', true],
  ])('rejette la clé injectée « %s » (la cible est la session, pas le payload)', (cle, valeur) => {
    expect(schemaToutMarquerLu.safeParse({ [cle]: valeur }).success).toBe(false)
  })
})

// ─── .strict() : toute clé non listée fait échouer le parse ─────────────────
// Une clé inconnue n'est jamais un « détail » : c'est une écriture hors
// contrat (destinataire injecté, date de lecture, état de préférence…). Chaque
// schéma doit la refuser, quelles que soient ses valeurs.
// ---------------------------------------------------------------------------

const SCHEMAS_ET_CHARGE_MINIMALE = [
  ['schemaCurseurNotifications', schemaCurseurNotifications, {}],
  ['schemaMarquerNotificationLu', schemaMarquerNotificationLu, { notificationId: 1 }],
  ['schemaToutMarquerLu', schemaToutMarquerLu, {}],
  ['schemaSupprimerNotification', schemaSupprimerNotification, { notificationId: 1 }],
  ['schemaPreferenceEmailType', schemaPreferenceEmailType, { type: 'systeme', emailActive: true }],
  ['schemaReglageResumeQuotidien', schemaReglageResumeQuotidien, { resumeQuotidien: true }],
] as const

const CLES_INCONNUES: ReadonlyArray<[cle: string, valeur: unknown]> = [
  ['destinataireId', 7],
  ['userId', 7],
  ['utilisateurId', 7],
  ['lu', true],
  ['lueLe', '2026-01-31T12:00:00Z'],
  ['email', 'intrus@exemple.fr'],
  ['isAdmin', true],
]

describe.each(SCHEMAS_ET_CHARGE_MINIMALE)('%s — liste blanche', (_nom, schema, valide) => {
  it.each(CLES_INCONNUES)('rejette la clé inconnue « %s »', (cle, valeur) => {
    const resultat = schema.safeParse({ ...valide, [cle]: valeur })
    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys')
      expect(resultat.error.message).toContain(cle)
    }
  })
})
