import { NextResponse } from 'next/server'

import { offreVisible } from '@/lib/offres-public'
import { prisma } from '@/lib/prisma'

// ─── API publique : compteurs réels de l'accueil ────────────────────────────
// Alimente <HomeStats /> : la page d'accueil doit rester synchrone (règle de
// suspension #98097), les chiffres viennent donc d'un route handler (DAL
// réservée aux route handlers / server actions).
// Offres = prédicat unique de la DAL publique (publiée, jour d'expiration
// inclus, recruteur actif) : les compteurs de l'accueil et la page /offres
// ne peuvent plus diverger (décision 4 de l'étape 2). Rien n'est inventé
// côté client : seuls les compteurs > 0 sont affichés (règle
// anti-vibecoding) — sur une base vide, le bloc est absent.
// Non caché par Next (compteurs vivants, route handler non mis en cache par
// défaut) ; Cache-Control laisse le navigateur réutiliser 60 s la réponse.
// ---------------------------------------------------------------------------

export async function GET() {
  const now = new Date()
  const [offres, entreprises, candidats] = await Promise.all([
    prisma.offre.count({ where: offreVisible(now) }),
    prisma.entreprise.count(),
    prisma.user.count({ where: { role: 'candidat' } }),
  ])

  return NextResponse.json(
    { offres, entreprises, candidats },
    {
      headers: {
        'Cache-Control':
          'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      },
    },
  )
}
