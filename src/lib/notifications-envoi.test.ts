import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmailConstruit } from './notifications-emails'
import { envoyerEmail, estEnvoiConfigure } from './notifications-envoi'

// ─── Contrats du client Resend (M9, Vague 3) ────────────────────────────────
// Verrous :
//  1. sans RESEND_API_KEY ou EMAIL_FROM : aucun fetch, résultat `configuration`
//     (l'outbox laisse alors les lignes EN ATTENTE, sans consommer de tentative) ;
//  2. requête POST conforme à l'API Resend (from, to tableau, subject, text,
//     html, Bearer), délai borné ;
//  3. toute défaillance rend un CODE COURT (`http_<statut>`, `reseau`,
//     `delai`) — jamais le corps d'erreur, jamais l'adresse du destinataire,
//     jamais d'exception ;
//  4. aucun appel console (aucune PII dans les journaux).
// ---------------------------------------------------------------------------

const EMAIL: EmailConstruit = {
  sujet: 'Job4Us : Nouvelle candidature',
  texte: 'Un candidat a postulé.',
  html: '<p>Un candidat a postulé.</p>',
}

const DESTINATAIRE = 'destinataire@exemple.test'

const fetchMock = vi.fn<
  (url: string | URL | Request, options?: RequestInit) => Promise<Response>
>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('RESEND_API_KEY', 're_test_123')
  vi.stubEnv('EMAIL_FROM', 'Job4Us <notifications@exemple.test>')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function reponse(ok: boolean, status: number): Response {
  return { ok, status } as Response
}

describe('estEnvoiConfigure', () => {
  it('vrai seulement quand la clé ET l’expéditeur sont fournis', () => {
    expect(estEnvoiConfigure()).toBe(true)

    vi.stubEnv('RESEND_API_KEY', '')
    expect(estEnvoiConfigure()).toBe(false)

    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('EMAIL_FROM', '   ')
    expect(estEnvoiConfigure()).toBe(false)
  })
})

describe('envoyerEmail (configuration absente)', () => {
  it('sans clé : aucun fetch, code `configuration`', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })).resolves.toEqual({
      ok: false,
      erreur: 'configuration',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sans expéditeur : aucun fetch, code `configuration`', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    await expect(envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })).resolves.toEqual({
      ok: false,
      erreur: 'configuration',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('envoyerEmail (requête HTTP)', () => {
  it('envoie un POST JSON conforme à l’API Resend', async () => {
    fetchMock.mockResolvedValue(reponse(true, 200))

    await expect(envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })).resolves.toEqual({
      ok: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.resend.com/emails')
    expect(options?.method).toBe('POST')
    expect(options?.headers).toEqual({
      Authorization: 'Bearer re_test_123',
      'Content-Type': 'application/json',
    })
    expect(options?.body).toBe(
      JSON.stringify({
        from: 'Job4Us <notifications@exemple.test>',
        to: [DESTINATAIRE],
        subject: EMAIL.sujet,
        text: EMAIL.texte,
        html: EMAIL.html,
      }),
    )
    // Délai borné : un cron ne reste jamais suspendu sur un appel réseau.
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('statut HTTP non 2xx : code court `http_<statut>`, corps jamais lu', async () => {
    const json = vi.fn()
    fetchMock.mockResolvedValue({ ok: false, status: 422, json } as unknown as Response)

    await expect(envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })).resolves.toEqual({
      ok: false,
      erreur: 'http_422',
    })
    expect(json).not.toHaveBeenCalled()
  })

  it('panne réseau : `reseau`, sans exception ni PII', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const resultat = await envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })
    expect(resultat).toEqual({ ok: false, erreur: 'reseau' })
    expect(JSON.stringify(resultat)).not.toContain(DESTINATAIRE)
  })

  it('délai dépassé : `delai` (TimeoutError)', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })).resolves.toEqual({
      ok: false,
      erreur: 'delai',
    })
  })

  it('aucune trace console : aucune coordonnée ne fuit dans les journaux', async () => {
    fetchMock.mockResolvedValue(reponse(true, 200))
    await envoyerEmail({ destinataire: DESTINATAIRE, email: EMAIL })
    expect(console.error).not.toHaveBeenCalled()
  })
})
