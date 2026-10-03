import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SITE_URL } from '@/lib/site-url'

import sitemap from './sitemap'

// ─── Tests du sitemap public (M5, task 6) ────────────────────────────────────
// Verrouillent : URLs absolues exigées par le protocole, seules les offres
// fournies par la DAL (donc visibles — prédicat unique testé dans
// offres-public.test.ts), aucune page auth, aucune donnée autre que
// slug + lastModified. Le legacy n'avait AUCUN sitemap (vérifié) : ce
// fichier est exigé par les critères M5.
// ---------------------------------------------------------------------------

const { slugsOffresVisibles } = vi.hoisted(() => ({
  slugsOffresVisibles: vi.fn<
    () => Promise<Array<{ slug: string; updatedAt: Date }>>
  >(),
}))

vi.mock('@/lib/offres-public', () => ({
  slugsOffresVisibles,
}))

describe('sitemap', () => {
  beforeEach(() => {
    slugsOffresVisibles.mockReset()
    slugsOffresVisibles.mockResolvedValue([
      { slug: 'developpeur-back-end-1', updatedAt: new Date('2026-10-01T10:00:00Z') },
      { slug: 'commercial-douala-2', updatedAt: new Date('2026-10-02T10:00:00Z') },
    ])
  })

  it('publie accueil + liste, puis une URL ABSOLUE par offre visible', async () => {
    const entrees = await sitemap()

    expect(entrees).toEqual([
      { url: SITE_URL },
      { url: `${SITE_URL}/offres` },
      {
        url: `${SITE_URL}/offres/developpeur-back-end-1`,
        lastModified: new Date('2026-10-01T10:00:00Z'),
      },
      {
        url: `${SITE_URL}/offres/commercial-douala-2`,
        lastModified: new Date('2026-10-02T10:00:00Z'),
      },
    ])
    for (const entree of entrees) {
      expect(entree.url).toMatch(/^https?:\/\//)
    }
  })

  it('demande la liste des slugs visibles à la DAL (une seule fois)', async () => {
    await sitemap()

    expect(slugsOffresVisibles).toHaveBeenCalledTimes(1)
  })

  it('n-indexe aucune page auth et ne publie que url + lastModified', async () => {
    const entrees = await sitemap()

    const urls = entrees.map((entree) => entree.url)
    for (const pageAuth of ['/login', '/register', '/unauthorized']) {
      expect(urls.some((url) => url.includes(pageAuth))).toBe(false)
    }

    expect(Object.keys(entrees[0]).sort()).toEqual(['url'])
    expect(Object.keys(entrees[1]).sort()).toEqual(['url'])
    expect(Object.keys(entrees[2]).sort()).toEqual(['lastModified', 'url'])
    expect(Object.keys(entrees[3]).sort()).toEqual(['lastModified', 'url'])
  })

  it('sérialise sans double slash si l’env porte une barre oblique', () => {
    expect(SITE_URL.endsWith('/')).toBe(false)
  })
})
