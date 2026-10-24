import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BilanExpirations } from '@/lib/notifications-expiration'
import type { BilanFile, BilanResumes } from '@/lib/notifications-outbox'

import { GET } from './route'

// ─── Tests de GET /api/cron/notifications (M9, Vague 3) ─────────────────────
// Verrous :
//  1. pas de CRON_SECRET → 503 sans exécuter AUCUNE tâche ;
//  2. secret valide → 200 ; en-tête absent/faux → 401 (comparaison stricte) ;
//  3. ordre expirations → digest → file → archivage → purge ;
//  4. un échec de tâche est RAPPORTÉ par code, sans bloquer les suivantes ;
//  5. réponse en compteurs uniquement (aucune PII), non cacheable.
// ---------------------------------------------------------------------------

const ORDRE: string[] = []

const BILAN_EXPIRATIONS: BilanExpirations = { offres: 2, notifications: 4 }

const BILAN_FILE: BilanFile = {
  configuration: true,
  examines: 3,
  envoyes: 2,
  reportes: 1,
  echecs: 0,
  abandons: 0,
}

const BILAN_RESUMES: BilanResumes = { candidats: 4, crees: 2 }

const {
  expirationsMock,
  preparerMock,
  traiterMock,
  archiverMock,
  purgerMock,
  configureMock,
} = vi.hoisted(() => ({
  expirationsMock: vi.fn<() => Promise<BilanExpirations>>(),
  preparerMock: vi.fn<() => Promise<BilanResumes>>(),
  traiterMock: vi.fn<() => Promise<BilanFile>>(),
  archiverMock: vi.fn<() => Promise<number>>(),
  purgerMock: vi.fn<() => Promise<number>>(),
  configureMock: vi.fn<() => boolean>(),
}))

vi.mock('@/lib/notifications-expiration', () => ({
  notifierOffresExpirees: expirationsMock,
}))

vi.mock('@/lib/notifications-outbox', () => ({
  preparerResumesQuotidiens: preparerMock,
  traiterFileEmails: traiterMock,
}))

vi.mock('@/lib/notifications-dal', () => ({
  archiverLuees: archiverMock,
  purgerArchivees: purgerMock,
}))

vi.mock('@/lib/notifications-envoi', () => ({
  estEnvoiConfigure: configureMock,
}))

const SECRET = 'secret-cron-de-test'

function requete(authorization?: string): NextRequest {
  const entetes = new Headers()
  if (authorization !== undefined) entetes.set('authorization', authorization)
  return new NextRequest('http://localhost:3000/api/cron/notifications', {
    headers: entetes,
  })
}

beforeEach(() => {
  ORDRE.length = 0
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('AUTH_SECRET', 'secret-auth-de-test')

  expirationsMock.mockReset().mockImplementation(async () => {
    ORDRE.push('expirations')
    return BILAN_EXPIRATIONS
  })
  preparerMock.mockReset().mockImplementation(async () => {
    ORDRE.push('resumes')
    return BILAN_RESUMES
  })
  traiterMock.mockReset().mockImplementation(async () => {
    ORDRE.push('file')
    return BILAN_FILE
  })
  archiverMock.mockReset().mockImplementation(async () => {
    ORDRE.push('archives')
    return 5
  })
  purgerMock.mockReset().mockImplementation(async () => {
    ORDRE.push('purges')
    return 2
  })
  configureMock.mockReset().mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authentification du cron', () => {
  it('sans CRON_SECRET : 503 et AUCUNE tâche exécutée', async () => {
    vi.stubEnv('CRON_SECRET', '')

    const reponse = await GET(requete(`Bearer ${SECRET}`))

    expect(reponse.status).toBe(503)
    await expect(reponse.json()).resolves.toEqual({ error: 'cron_non_configure' })
    expect(ORDRE).toEqual([])
  })

  it('sans en-tête Authorization : 401 et aucune tâche', async () => {
    const reponse = await GET(requete())

    expect(reponse.status).toBe(401)
    await expect(reponse.json()).resolves.toEqual({ error: 'non_autorise' })
    expect(ORDRE).toEqual([])
  })

  it('secret erroné (même longueur) : 401', async () => {
    const reponse = await GET(requete(`Bearer ${'x'.repeat(SECRET.length)}`))
    expect(reponse.status).toBe(401)
    expect(ORDRE).toEqual([])
  })

  it('schéma ou longueur différents : 401 sans jeter', async () => {
    expect((await GET(requete(SECRET))).status).toBe(401)
    expect((await GET(requete(`Bearer ${SECRET}x`))).status).toBe(401)
    expect((await GET(requete('bearer ' + SECRET))).status).toBe(401)
    expect(ORDRE).toEqual([])
  })
})

describe('exécution des tâches', () => {
  it('enchaîne expirations, résumés, file, archivage, purge et rend les compteurs', async () => {
    const reponse = await GET(requete(`Bearer ${SECRET}`))

    expect(reponse.status).toBe(200)
    expect(ORDRE).toEqual([
      'expirations',
      'resumes',
      'file',
      'archives',
      'purges',
    ])

    const corps = await reponse.json()
    expect(corps).toEqual({
      ok: true,
      configuration: true,
      expirations: BILAN_EXPIRATIONS,
      resumes: BILAN_RESUMES,
      file: BILAN_FILE,
      archives: 5,
      purges: 2,
      erreurs: [],
    })
  })

  it('un échec d’expiration est rapporté SANS bloquer les autres tâches', async () => {
    expirationsMock.mockRejectedValue(new Error('base indisponible'))

    const reponse = await GET(requete(`Bearer ${SECRET}`))

    expect(reponse.status).toBe(200)
    expect(ORDRE).toEqual(['resumes', 'file', 'archives', 'purges'])
    const corps = (await reponse.json()) as { erreurs: string[] }
    expect(corps.erreurs).toEqual(['expirations'])
  })

  it('un échec de digest est rapporté SANS bloquer les autres tâches', async () => {
    preparerMock.mockRejectedValue(new Error('base indisponible'))

    const reponse = await GET(requete(`Bearer ${SECRET}`))

    expect(reponse.status).toBe(200)
    expect(ORDRE).toEqual(['expirations', 'file', 'archives', 'purges'])
    const corps = (await reponse.json()) as { erreurs: string[] }
    expect(corps.erreurs).toEqual(['resumes'])
  })

  it('tous les échecs sont réduits à des CODES, aucune PII dans la réponse', async () => {
    expirationsMock.mockRejectedValue(new Error('destinataire@exemple.test'))
    preparerMock.mockRejectedValue(new Error('destinataire@exemple.test'))
    traiterMock.mockRejectedValue(new Error('destinataire@exemple.test'))
    archiverMock.mockRejectedValue(new Error('destinataire@exemple.test'))
    purgerMock.mockRejectedValue(new Error('destinataire@exemple.test'))

    const reponse = await GET(requete(`Bearer ${SECRET}`))
    const texte = JSON.stringify(await reponse.json())

    expect(texte).not.toContain('@')
    expect(texte).toContain('expirations')
    expect(texte).toContain('resumes')
    expect(texte).toContain('file')
    expect(texte).toContain('archives')
    expect(texte).toContain('purges')
  })

  it('configuration d’envoi absente : le bilan le dit (file non configurée)', async () => {
    configureMock.mockReturnValue(false)
    traiterMock.mockResolvedValue({
      configuration: false,
      examines: 0,
      envoyes: 0,
      reportes: 0,
      echecs: 0,
      abandons: 0,
    })

    const reponse = await GET(requete(`Bearer ${SECRET}`))
    const corps = (await reponse.json()) as { configuration: boolean }

    expect(corps.configuration).toBe(false)
  })

  it('réponse non cacheable (un cron doit toujours réexécuter)', async () => {
    const reponse = await GET(requete(`Bearer ${SECRET}`))
    expect(reponse.headers.get('Cache-Control')).toContain('no-store')
  })
})
