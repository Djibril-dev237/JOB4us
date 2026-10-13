import { describe, expect, it } from 'vitest'

import { GARDE_LONGUEUR_BRUT } from './messagerie-contenu'
import {
  schemaBloquerUtilisateur,
  schemaCurseurMessages,
  schemaEnvoyerMessage,
  schemaMasquerConversation,
  schemaSignalerMessage,
  schemaTraiterSignalement,
} from './messagerie-schemas'

// ─── Contrats des schémas M8 (Vague 1) ───────────────────────────────────────
// Verrouillent la FORME uniquement (le nettoyage appartient aux actions) :
// entiers stricts (jamais « 42 »), zéro et négatif rejetés, `.strict()`
// contre les clés injectées, curseur ISO-8601 avec offset, motif ≥ 3,
// garde brute 8000 avant nettoyage.
// ---------------------------------------------------------------------------

describe('schemaEnvoyerMessage — charge valide', () => {
  it('accepte un envoi minimal et retourne le payload identique', () => {
    const payload = { conversationId: 12, contenu: 'Bonjour, ce poste est-il toujours ouvert ?' }
    expect(schemaEnvoyerMessage.parse(payload)).toEqual(payload)
  })

  it('accepte une charge maximale (garde brute) sans la tronquer', () => {
    // Le schema ne tronque PAS : la borne réelle revient à l'action.
    const payload = { conversationId: 1, contenu: 'x'.repeat(GARDE_LONGUEUR_BRUT) }
    expect(schemaEnvoyerMessage.parse(payload).contenu).toHaveLength(GARDE_LONGUEUR_BRUT)
  })
})

describe('schemaEnvoyerMessage — entiers stricts', () => {
  it.each(['42', 3.5, null, undefined, Number.NaN])(
    'rejette conversationId = %j (pas un entier positif)',
    (valeur) => {
      expect(
        schemaEnvoyerMessage.safeParse({ conversationId: valeur, contenu: 'salut' }).success,
      ).toBe(false)
    },
  )

  it.each([0, -1])('rejette conversationId = %i', (valeur) => {
    expect(
      schemaEnvoyerMessage.safeParse({ conversationId: valeur, contenu: 'salut' }).success,
    ).toBe(false)
  })

  it('rejette conversationId au-delà de l’Int32 (un id géant ferait échouer Prisma : 500 évité)', () => {
    // 2^31 : la borne exacte du type Int MySQL — Prisma lève hors de toute
    // gestion au-delà, donc le schema refuse AVANT toute requête.
    expect(
      schemaEnvoyerMessage.safeParse({ conversationId: 2_147_483_648, contenu: 'salut' }).success,
    ).toBe(false)
    expect(
      schemaEnvoyerMessage.safeParse({ conversationId: 2_147_483_647, contenu: 'salut' }).success,
    ).toBe(true)
  })

  it('rejette un contenu vide', () => {
    expect(schemaEnvoyerMessage.safeParse({ conversationId: 1, contenu: '' }).success).toBe(false)
  })

  it('rejette un contenu de 8001 caractères (au-delà de la garde brute)', () => {
    expect(
      schemaEnvoyerMessage.safeParse({
        conversationId: 1,
        contenu: 'x'.repeat(GARDE_LONGUEUR_BRUT + 1),
      }).success,
    ).toBe(false)
  })

  it('accepte exactement 8000 caractères de contenu (garde brute)', () => {
    expect(
      schemaEnvoyerMessage.safeParse({
        conversationId: 1,
        contenu: 'x'.repeat(GARDE_LONGUEUR_BRUT),
      }).success,
    ).toBe(true)
  })
})

describe('schemaCurseurMessages — curseur ISO-8601', () => {
  it('accepte un curseur Z et un curseur avec offset', () => {
    expect(
      schemaCurseurMessages.parse({
        conversationId: 3,
        curseur: '2026-01-31T12:00:00Z',
      }).curseur,
    ).toBe('2026-01-31T12:00:00Z')
    expect(
      schemaCurseurMessages.safeParse({
        conversationId: 3,
        curseur: '2026-01-31T12:00:00+01:00',
      }).success,
    ).toBe(true)
  })

  it('accepte l’absence de curseur (premier chargement)', () => {
    expect(schemaCurseurMessages.parse({ conversationId: 3 })).toEqual({ conversationId: 3 })
  })

  it.each(['31/01/2026', '2026-01-31', 'hier', '2026-01-31T12:00:00'])(
    'rejette le curseur non ISO-8601 « %s »',
    (curseur) => {
      expect(schemaCurseurMessages.safeParse({ conversationId: 3, curseur }).success).toBe(false)
    },
  )
})

describe('schemas d’identifiants — entiers positifs', () => {
  it.each([
    ['schemaMasquerConversation', schemaMasquerConversation, { conversationId: 1 }],
    ['schemaBloquerUtilisateur', schemaBloquerUtilisateur, { cibleUserId: 1 }],
  ] as const)('%s accepte la charge valide', (_nom, schema, valide) => {
    expect(schema.parse(valide)).toEqual(valide)
  })

  it.each([
    ['schemaMasquerConversation', schemaMasquerConversation, 'conversationId'],
    ['schemaBloquerUtilisateur', schemaBloquerUtilisateur, 'cibleUserId'],
  ] as const)(
    '%s rejette « %s » en chaîne, à zéro et négatif',
    (_nom, schema, cle) => {
      for (const valeur of ['7', 0, -12, 2_147_483_648]) {
        expect(schema.safeParse({ [cle]: valeur }).success).toBe(false)
      }
    },
  )
})

describe('schemaSignalerMessage — motif', () => {
  it('accepte un signalement valide', () => {
    const payload = { messageId: 42, motif: 'Contenu harcelant envers les candidates.' }
    expect(schemaSignalerMessage.parse(payload)).toEqual(payload)
  })

  it.each(['ab', 'x', ''])('rejette le motif trop court « %s »', (motif) => {
    expect(schemaSignalerMessage.safeParse({ messageId: 1, motif }).success).toBe(false)
  })

  it('rejette messageId en chaîne, à zéro ou négatif', () => {
    for (const messageId of ['1', 0, -1]) {
      expect(schemaSignalerMessage.safeParse({ messageId, motif: 'valide' }).success).toBe(false)
    }
  })
})

describe('schemaTraiterSignalement — noteInterne', () => {
  it('accepte un traitement sans note, avec note courte, et rejette 2001', () => {
    expect(schemaTraiterSignalement.parse({ signalementId: 9 })).toEqual({ signalementId: 9 })
    expect(
      schemaTraiterSignalement.parse({ signalementId: 9, noteInterne: 'Aucun antécédent.' })
        .noteInterne,
    ).toBe('Aucun antécédent.')
    expect(
      schemaTraiterSignalement.safeParse({
        signalementId: 9,
        noteInterne: 'n'.repeat(2001),
      }).success,
    ).toBe(false)
  })
})

// ─── .strict() : toute clé non listée fait échouer le parse ─────────────────
// Une clé inconnue n'est jamais un « détail » : c'est une écriture hors
// contrat (auteur injecté, statut, chemin de fichier…). Chaque schéma doit
// la refuser, quelles que soient ses valeurs.
// ---------------------------------------------------------------------------

const SCHEMAS_ET_CHARGE_MINIMALE = [
  ['schemaEnvoyerMessage', schemaEnvoyerMessage, { conversationId: 1, contenu: 'salut' }],
  ['schemaCurseurMessages', schemaCurseurMessages, { conversationId: 1 }],
  ['schemaMasquerConversation', schemaMasquerConversation, { conversationId: 1 }],
  ['schemaBloquerUtilisateur', schemaBloquerUtilisateur, { cibleUserId: 1 }],
  ['schemaSignalerMessage', schemaSignalerMessage, { messageId: 1, motif: 'motif valide' }],
  ['schemaTraiterSignalement', schemaTraiterSignalement, { signalementId: 1 }],
] as const

const CLES_INCONNUES: ReadonlyArray<[cle: string, valeur: unknown]> = [
  ['auteurId', 7],
  ['authorId', 7],
  ['destinataireId', 7],
  ['statut', 'lu'],
  ['cvPath', 'messagerie/fichier.pdf'],
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
