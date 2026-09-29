import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'

// ─── API publique : catégories de l'accueil ─────────────────────────────────
// Alimente <HomeCategories /> (la page reste synchrone, règle #98097).
// Seules les catégories comptant au moins une offre active et non expirée
// sont renvoyées : aucune carte morte « 0 offre » (honnêteté du contenu), et
// la section entière disparaît si la base est vide. Tri alpha, fidèle à la
// liste legacy.
// ---------------------------------------------------------------------------

export async function GET() {
  const now = new Date()
  const categories = await prisma.categorie.findMany({
    where: {
      offres: { some: { isActive: true, dateExpiration: { gte: now } } },
    },
    orderBy: { nom: 'asc' },
    select: {
      id: true,
      nom: true,
      offres: {
        where: { isActive: true, dateExpiration: { gte: now } },
        select: { id: true },
      },
    },
  })

  return NextResponse.json(
    categories.map((category) => ({
      id: category.id,
      nom: category.nom,
      offres: category.offres.length,
    })),
    {
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      },
    },
  )
}
