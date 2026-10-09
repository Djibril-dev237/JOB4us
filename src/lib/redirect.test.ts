import { describe, expect, it } from 'vitest'

import { REDIRECTION_LONGUEUR_MAX, redirectionInterne } from '@/lib/redirect'

// ─── Anti open-redirect : cibles de même origine uniquement ──────────────────
//
// Le contrôle protège la page de connexion (M1) reprise par le parcours de
// postulation (M7) : TOUT vecteur d'ouverture vers une origine étrangère
// doit retomber sur `null` → `/` côté action.
describe('redirectionInterne', () => {
  describe('cibles internes acceptées', () => {
    it('accepte la racine', () => {
      expect(redirectionInterne('/')).toBe('/')
    })

    it('accepte un chemin simple', () => {
      expect(redirectionInterne('/offres')).toBe('/offres')
    })

    it('accepte un chemin de postulation (usage M7)', () => {
      expect(redirectionInterne('/offres/developpeur-web-1/postuler')).toBe(
        '/offres/developpeur-web-1/postuler',
      )
    })

    it('accepte un chemin avec query et fragment', () => {
      expect(redirectionInterne('/candidat/candidatures?statut=entretien')).toBe(
        '/candidat/candidatures?statut=entretien',
      )
      expect(redirectionInterne('/offres?page=2#contenu')).toBe('/offres?page=2#contenu')
    })

    it('accepte un chemin unicode (chemin de même origine quelconque)', () => {
      expect(redirectionInterne('/offres/café')).toBe('/offres/café')
    })

    it('accepte la longueur maximale exacte', () => {
      const cible = `/${'a'.repeat(REDIRECTION_LONGUEUR_MAX - 1)}`
      expect(cible.length).toBe(REDIRECTION_LONGUEUR_MAX)
      expect(redirectionInterne(cible)).toBe(cible)
    })
  })

  describe('vecteurs d’ouverture vers une origine étrangère', () => {
    it('rejette une URL absolue', () => {
      expect(redirectionInterne('https://evil.example')).toBeNull()
      expect(redirectionInterne('http://evil.example')).toBeNull()
    })

    it('rejette l’URL protocole-relatif //host', () => {
      expect(redirectionInterne('//evil.example')).toBeNull()
      expect(redirectionInterne('///evil.example')).toBeNull()
    })

    it('rejette le schéma javascript:', () => {
      expect(redirectionInterne('javascript:alert(1)')).toBeNull()
      expect(redirectionInterne('/javascript:alert(1)')).toBe(
        '/javascript:alert(1)', // chemin : même origine, donc inoffensif
      )
    })

    it('rejette un host sans schéma', () => {
      expect(redirectionInterne('evil.example')).toBeNull()
    })

    it('rejette mailto: et les autres schémas', () => {
      expect(redirectionInterne('mailto:a@b.c')).toBeNull()
      expect(redirectionInterne('data:text/html,<script>')).toBeNull()
    })

    it('rejette l’antislash d’évasion /\evil.example', () => {
      expect(redirectionInterne('/\\evil.example')).toBeNull()
      expect(redirectionInterne('\\/evil.example')).toBeNull()
    })
  })

  describe('cibles malformées', () => {
    it('rejette la chaîne vide (champ absent du formulaire)', () => {
      expect(redirectionInterne('')).toBeNull()
    })

    it('rejette les caractères de contrôle (injection d’en-tête)', () => {
      expect(redirectionInterne('/offres\r\nSet-Cookie: x=1')).toBeNull()
      expect(redirectionInterne('/offres\n')).toBeNull()
      expect(redirectionInterne('/offres\0')).toBeNull()
      expect(redirectionInterne('/offres\t')).toBeNull()
      expect(redirectionInterne('/offres\u007f')).toBeNull()
    })

    it('rejette une cible trop longue', () => {
      const tropLongue = `/${'a'.repeat(REDIRECTION_LONGUEUR_MAX)}`
      expect(tropLongue.length).toBe(REDIRECTION_LONGUEUR_MAX + 1)
      expect(redirectionInterne(tropLongue)).toBeNull()
    })
  })
})
