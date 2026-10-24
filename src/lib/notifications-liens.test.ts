import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SITE_URL } from './site-url'
import {
  DUREE_JETON_MS,
  creerJetonDesabonnement,
  estLienInterne,
  liensEmail,
  verifierJetonDesabonnement,
} from './notifications-liens'

// ─── Contrats des liens et du jeton de désabonnement (M9, Vague 3) ──────────
// Verrous :
//  1. `estLienInterne` n'accepte QUE des chemins du site : ni schéma
//     exécutable, ni URL protocol-relative, ni antislash, ni contrôle ;
//  2. le jeton est un HMAC-SHA256 sur `AUTH_SECRET`, personnel, valable
//     EXACTEMENT 7 jours (valeur de `TEXTES.explicationJeton`), comparé en
//     temps constant et refusé dès l'expiration ;
//  3. toute altération (payload, signature, forme) rend `null` sans jeter ;
//  4. sans `AUTH_SECRET`, création et vérification rendent `null` — jamais
//     d'exception dans un cron ;
//  5. `liensEmail` construit les deux URLs absolues du pied de page.
// ---------------------------------------------------------------------------

const SECRET = 'secret-de-test-m9-vague-3'
const MAINTENANT = new Date('2026-10-24T08:00:00.000Z')

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('estLienInterne (défense en profondeur des liens stockés)', () => {
  it('accepte les chemins internes réellement émis par les hooks M7/M8', () => {
    expect(estLienInterne('/')).toBe(true)
    expect(estLienInterne('/messages/42')).toBe(true)
    expect(estLienInterne('/offres/developpeur-web-12')).toBe(true)
    expect(estLienInterne('/notifications/preferences')).toBe(true)
    expect(estLienInterne('/admin/dashboard')).toBe(true)
  })

  it('rejette les schémas exécutables et les URL absolues', () => {
    expect(estLienInterne('javascript:alert(1)')).toBe(false)
    expect(estLienInterne('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(estLienInterne('https://exemple.test/phishing')).toBe(false)
    expect(estLienInterne('mailto:contact@exemple.test')).toBe(false)
  })

  it('rejette les sorties de site déguisées', () => {
    expect(estLienInterne('//exemple.test/phishing')).toBe(false)
    expect(estLienInterne('/\\exemple.test/phishing')).toBe(false)
    expect(estLienInterne('/\\/exemple.test')).toBe(false)
  })

  it('rejette les espaces et caractères de contrôle', () => {
    expect(estLienInterne('/\tjavascript:alert(1)')).toBe(false)
    expect(estLienInterne('/messages/42\nSet-Cookie: x')).toBe(false)
    expect(estLienInterne('/messages 42')).toBe(false)
    expect(estLienInterne('/messages/42\u0000')).toBe(false)
    expect(estLienInterne('/messages/42\u007f')).toBe(false)
    expect(estLienInterne('/messages/42\u0085')).toBe(false)
  })

  it('rejette un chemin relatif sans slash initial ou une chaîne vide', () => {
    expect(estLienInterne('')).toBe(false)
    expect(estLienInterne('messages/42')).toBe(false)
    expect(estLienInterne(' /messages/42')).toBe(false)
  })
})

describe('creerJetonDesabonnement', () => {
  it('produit un jeton à 4 segments, sans donnée personnelle', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT)
    expect(jeton).not.toBeNull()

    const morceaux = (jeton ?? '').split('.')
    expect(morceaux).toHaveLength(4)
    expect(morceaux[0]).toBe('v1')
    expect(morceaux[1]).toBe('7')
    expect(morceaux[2]).toBe(String(MAINTENANT.getTime() + DUREE_JETON_MS))
    expect(morceaux[3]).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('durée de vie = 7 jours, valeur de TEXTES.explicationJeton', () => {
    expect(DUREE_JETON_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('rejette les identifiants non entiers ou non positifs', () => {
    expect(creerJetonDesabonnement(0, MAINTENANT)).toBeNull()
    expect(creerJetonDesabonnement(-1, MAINTENANT)).toBeNull()
    expect(creerJetonDesabonnement(1.5, MAINTENANT)).toBeNull()
    expect(creerJetonDesabonnement(Number.NaN, MAINTENANT)).toBeNull()
  })

  it('rend null sans AUTH_SECRET (l’email sera sauté, jamais une exception)', () => {
    vi.stubEnv('AUTH_SECRET', '')
    expect(creerJetonDesabonnement(7, MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v1.7.1.abc', MAINTENANT)).toBeNull()
    expect(liensEmail(7, MAINTENANT)).toBeNull()
  })
})

describe('verifierJetonDesabonnement', () => {
  it('accepte un jeton authentique et rend SON porteur', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT)
    expect(jeton).not.toBeNull()
    expect(verifierJetonDesabonnement(jeton ?? '', MAINTENANT)).toEqual({ userId: 7 })
  })

  it('accepte jusqu’à la dernière milliseconde, refuse à l’instant d’expiration', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT) ?? ''
    const avantExpiration = new Date(MAINTENANT.getTime() + DUREE_JETON_MS - 1)
    const expiration = new Date(MAINTENANT.getTime() + DUREE_JETON_MS)

    expect(verifierJetonDesabonnement(jeton, avantExpiration)).toEqual({ userId: 7 })
    expect(verifierJetonDesabonnement(jeton, expiration)).toBeNull()
    expect(
      verifierJetonDesabonnement(jeton, new Date(MAINTENANT.getTime() + DUREE_JETON_MS + 1)),
    ).toBeNull()
  })

  it('refuse une altération du porteur ou de l’expiration (signature invalide)', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT) ?? ''
    const [, , expiration, signature] = jeton.split('.')

    expect(verifierJetonDesabonnement(`v1.8.${expiration}.${signature}`, MAINTENANT)).toBeNull()
    const expirationAlteree = String(Number.parseInt(expiration ?? '0', 10) + 1)
    expect(verifierJetonDesabonnement(`v1.7.${expirationAlteree}.${signature}`, MAINTENANT)).toBeNull()
  })

  it('refuse une signature altérée, vide ou tronquée', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT) ?? ''
    const [prefixe, userId, expiration] = jeton.split('.')

    expect(verifierJetonDesabonnement(`${prefixe}.${userId}.${expiration}.`, MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement(`${prefixe}.${userId}.${expiration}.abc`, MAINTENANT)).toBeNull()
    expect(
      verifierJetonDesabonnement(`${prefixe}.${userId}.${expiration}.${'a'.repeat(43)}`, MAINTENANT),
    ).toBeNull()
  })

  it('refuse les formes inattendues sans jeter', () => {
    expect(verifierJetonDesabonnement('', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('abc', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v1.7.123', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v2.7.123.signature', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v1.07.123.signature', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v1.0.123.signature', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement('v1.7.-1.signature', MAINTENANT)).toBeNull()
    expect(verifierJetonDesabonnement(`v1.7.123.${'a'.repeat(600)}`, MAINTENANT)).toBeNull()
  })

  it('un jeton signé avec un AUTRE secret est refusé', () => {
    const jeton = creerJetonDesabonnement(7, MAINTENANT) ?? ''
    vi.stubEnv('AUTH_SECRET', 'un-autre-secret')
    expect(verifierJetonDesabonnement(jeton, MAINTENANT)).toBeNull()
  })
})

describe('liensEmail', () => {
  it('construit les deux URLs absolues du pied de page', () => {
    const liens = liensEmail(7, MAINTENANT)
    expect(liens).not.toBeNull()
    expect(liens?.preferences).toBe(`${SITE_URL}/notifications/preferences`)
    expect(liens?.desabonnement.startsWith(`${SITE_URL}/desabonnement/`)).toBe(true)
  })

  it('le jeton embarqué dans l’URL est vérifiable et porte le bon utilisateur', () => {
    const liens = liensEmail(42, MAINTENANT)
    const jeton = liens?.desabonnement.slice(`${SITE_URL}/desabonnement/`.length) ?? ''
    expect(verifierJetonDesabonnement(jeton, MAINTENANT)).toEqual({ userId: 42 })
  })
})
