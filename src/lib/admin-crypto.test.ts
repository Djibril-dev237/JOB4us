import { beforeAll, describe, expect, it } from 'vitest'

import {
  ADMIN_ACCES_SIGNALEMENT_TTL_MS,
  ADMIN_REAUTH_TTL_MS,
  base32Decode,
  base32Encode,
  chiffrerSecretTotp,
  creerJetonAccesSignalement,
  creerJetonReauth,
  dechiffrerSecretTotp,
  genererCodeTotp,
  genererCodesRecuperation,
  genererJeton,
  genererSecretTotp,
  hacherCodeRecuperation,
  hacherJeton,
  normaliserCodeRecuperation,
  pasTotp,
  verifierCodeTotp,
  verifierJetonAccesSignalement,
  verifierJetonReauth,
} from './admin-crypto'

const SECRET_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const CLE_TEST = Buffer.alloc(32, 7)

beforeAll(() => {
  process.env.ADMIN_2FA_KEY = CLE_TEST.toString('base64')
  process.env.AUTH_SECRET = 'secret-de-test-m10'
})

describe('base32', () => {
  it('encode et décode le secret RFC', () => {
    const octets = Buffer.from('12345678901234567890', 'ascii')
    expect(base32Encode(octets)).toBe(SECRET_RFC)
    expect(base32Decode(SECRET_RFC).toString('ascii')).toBe('12345678901234567890')
  })
})

describe('TOTP RFC 6238 (SHA-1, 6 chiffres, 30 s)', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ])('timestamp %i → %s', (secondes, attendu) => {
    const pas = Math.floor(secondes / 30)
    expect(genererCodeTotp(SECRET_RFC, pas)).toBe(attendu)
    expect(verifierCodeTotp(SECRET_RFC, attendu, null, secondes * 1000).valide).toBe(true)
  })

  it('accepte la fenêtre ±1 pas et renvoie le pas validé', () => {
    const maintenant = 59_000
    const pas = pasTotp(maintenant)
    const precedent = genererCodeTotp(SECRET_RFC, pas - 1)
    const suivant = genererCodeTotp(SECRET_RFC, pas + 1)
    expect(verifierCodeTotp(SECRET_RFC, precedent, null, maintenant)).toEqual({
      valide: true,
      pas: pas - 1,
    })
    expect(verifierCodeTotp(SECRET_RFC, suivant, null, maintenant)).toEqual({
      valide: true,
      pas: pas + 1,
    })
  })

  it('refuse un pas déjà consommé (anti-rejeu)', () => {
    const maintenant = 59_000
    const pas = pasTotp(maintenant)
    const code = genererCodeTotp(SECRET_RFC, pas)
    expect(verifierCodeTotp(SECRET_RFC, code, pas, maintenant).valide).toBe(false)
    expect(verifierCodeTotp(SECRET_RFC, code, pas - 1, maintenant).valide).toBe(true)
  })

  it('refuse un code mal formé, un mauvais code ou un secret vide', () => {
    expect(verifierCodeTotp(SECRET_RFC, '12345', null).valide).toBe(false)
    expect(verifierCodeTotp(SECRET_RFC, 'abcdef', null).valide).toBe(false)
    expect(verifierCodeTotp(SECRET_RFC, '000000', null).valide).toBe(false)
    expect(() => genererCodeTotp('', 1)).toThrow()
  })
})

describe('secret et chiffrement', () => {
  it('génère un secret base32 de 32 caractères', () => {
    const secret = genererSecretTotp()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(base32Decode(secret)).toHaveLength(20)
  })

  it('chiffre en AES-256-GCM et déchiffre à l’identique', () => {
    const chiffre = chiffrerSecretTotp(SECRET_RFC)
    expect(chiffre).not.toContain(SECRET_RFC)
    expect(chiffre.startsWith('v1:')).toBe(true)
    expect(dechiffrerSecretTotp(chiffre)).toBe(SECRET_RFC)
  })

  it('refuse une mauvaise clé ou un texte altéré', () => {
    const chiffre = chiffrerSecretTotp(SECRET_RFC)
    const mauvaiseCle = Buffer.alloc(32, 8)
    expect(() => dechiffrerSecretTotp(chiffre, mauvaiseCle)).toThrow()
    expect(() => dechiffrerSecretTotp(`${chiffre}x`)).toThrow()
    expect(() => dechiffrerSecretTotp('v1:invalide')).toThrow()
  })
})

describe('codes de récupération', () => {
  it('génère 10 codes uniques et 10 empreintes SHA-256', () => {
    const { codes, hashes } = genererCodesRecuperation()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(hashes).toHaveLength(10)
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/)
    }
    for (const hash of hashes) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('normalise la saisie avant le hachage', () => {
    expect(normaliserCodeRecuperation(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(hacherCodeRecuperation('abcd-efgh')).toBe(
      hacherCodeRecuperation('ABCD EFGH'),
    )
  })
})

describe('jetons opaques et signés', () => {
  it('génère des jetons aléatoires distincts et les hache', () => {
    const a = genererJeton()
    const b = genererJeton()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(hacherJeton(a)).toMatch(/^[a-f0-9]{64}$/)
    expect(hacherJeton(a)).not.toBe(hacherJeton(b))
  })

  it('lie le grant de signalement à l’admin, au signalement et au temps', () => {
    const maintenant = 1_000_000
    const jeton = creerJetonAccesSignalement(7, 42, maintenant)
    expect(verifierJetonAccesSignalement(jeton, 7, 42, maintenant)).toBe(true)
    expect(verifierJetonAccesSignalement(jeton, 8, 42, maintenant)).toBe(false)
    expect(verifierJetonAccesSignalement(jeton, 7, 43, maintenant)).toBe(false)
    expect(
      verifierJetonAccesSignalement(
        jeton,
        7,
        42,
        maintenant + ADMIN_ACCES_SIGNALEMENT_TTL_MS + 1,
      ),
    ).toBe(false)
    expect(verifierJetonAccesSignalement(null, 7, 42, maintenant)).toBe(false)
  })

  it('lie la réauthentification à l’admin et à 5 minutes', () => {
    const maintenant = 2_000_000
    const jeton = creerJetonReauth(7, maintenant)
    expect(verifierJetonReauth(jeton, 7, maintenant)).toBe(true)
    expect(verifierJetonReauth(jeton, 8, maintenant)).toBe(false)
    expect(verifierJetonReauth(jeton, 7, maintenant + ADMIN_REAUTH_TTL_MS + 1)).toBe(
      false,
    )
    expect(verifierJetonReauth(null, 7, maintenant)).toBe(false)
  })

  it('refuse un jeton signé altéré', () => {
    const jeton = creerJetonReauth(7)
    expect(verifierJetonReauth(`${jeton}x`, 7)).toBe(false)
    expect(verifierJetonReauth('pas-un-jeton', 7)).toBe(false)
  })
})
