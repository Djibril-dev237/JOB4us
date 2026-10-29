import { describe, expect, it } from 'vitest'

import { ActivationAdminSchema, CodeAdminSchema } from './admin-schemas'

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

function activation(overrides: Record<string, unknown> = {}) {
  return {
    token: 'a'.repeat(43),
    secret: SECRET,
    password: 'MotDePasse123',
    confirmPassword: 'MotDePasse123',
    code: '123456',
    ...overrides,
  }
}

describe('ActivationAdminSchema', () => {
  it('accepte une activation complète', () => {
    expect(ActivationAdminSchema.safeParse(activation()).success).toBe(true)
  })

  it('refuse un jeton mal formé', () => {
    const resultat = ActivationAdminSchema.safeParse(
      activation({ token: 'jeton avec espaces' }),
    )
    expect(resultat.success).toBe(false)
  })

  it('refuse un secret hors base32 ou trop court', () => {
    expect(ActivationAdminSchema.safeParse(activation({ secret: 'ABC' })).success).toBe(
      false,
    )
    expect(
      ActivationAdminSchema.safeParse(activation({ secret: 'ABCDEFGHIJKLMNOP' })).success,
    ).toBe(true)
    expect(
      ActivationAdminSchema.safeParse(activation({ secret: `${SECRET.slice(0, -1)}1` }))
        .success,
    ).toBe(false)
  })

  it.each([
    ['trop court', 'Court1'],
    ['sans minuscule', 'MOTDEPASSE123'],
    ['sans majuscule', 'motdepasse123'],
    ['sans chiffre', 'MotDePasseLong'],
  ])('refuse un mot de passe %s', (_libelle, password) => {
    const resultat = ActivationAdminSchema.safeParse(
      activation({ password, confirmPassword: password }),
    )
    expect(resultat.success).toBe(false)
  })

  it('refuse une confirmation différente', () => {
    const resultat = ActivationAdminSchema.safeParse(
      activation({ confirmPassword: 'AutreMotDePasse123' }),
    )
    expect(resultat.success).toBe(false)
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.path).toEqual(['confirmPassword'])
    }
  })

  it('refuse un code qui n’est pas 6 chiffres et les clés inconnues', () => {
    expect(ActivationAdminSchema.safeParse(activation({ code: '12345' })).success).toBe(
      false,
    )
    expect(ActivationAdminSchema.safeParse(activation({ code: 'abcdef' })).success).toBe(
      false,
    )
    expect(
      ActivationAdminSchema.safeParse({ ...activation(), role: 'admin' }).success,
    ).toBe(false)
  })
})

describe('CodeAdminSchema', () => {
  it('accepte un TOTP et un code de récupération', () => {
    expect(CodeAdminSchema.safeParse({ code: '123456' }).success).toBe(true)
    expect(CodeAdminSchema.safeParse({ code: 'ABCDE-FGHIJ' }).success).toBe(true)
  })

  it('refuse un code vide, trop court ou trop long', () => {
    expect(CodeAdminSchema.safeParse({ code: '' }).success).toBe(false)
    expect(CodeAdminSchema.safeParse({ code: '12345' }).success).toBe(false)
    expect(CodeAdminSchema.safeParse({ code: 'a'.repeat(33) }).success).toBe(false)
  })
})
