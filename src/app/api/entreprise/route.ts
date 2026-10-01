import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

// ─── API : profil de l'entreprise du recruteur connecté ──────────────────────
// Alimente <EntrepriseForm /> : la page /recruteur/entreprise reste synchrone
// (règle de suspension #98097), les données viennent d'un route handler.
//
// SÉCURITÉ (symétrique de GET /api/profile) :
// - 401 non connecté, 403 hors rôle recruteur : aucun chemin « entreprise
//   d'autrui », la lecture est strictement « moi » ;
// - le logo n'est renvoyé QUE comme chemin interne /api/files/logo (route à
//   matrice propriétaire+admin) — jamais de clé R2 ni d'URL signée ici ;
// - Cache-Control: private, no-store.
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }
  if (role !== 'recruteur') {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      entreprise: {
        select: {
          id: true,
          nom: true,
          secteurActivite: true,
          tailleEntreprise: true,
          description: true,
          siteWeb: true,
          emailContact: true,
          telephone: true,
          adresse: true,
          ville: true,
          pays: true,
          logo: true,
          isVerified: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!user) {
    return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
  }

  const entreprise = user.entreprise
  return NextResponse.json(
    {
      // Ligne absente : nom initial = nom du compte (parité du registre
      // legacy, valeur RÉELLE du compte — aucune écriture au GET).
      nom: entreprise?.nom ?? user.name,
      secteurActivite: entreprise?.secteurActivite ?? '',
      tailleEntreprise: entreprise?.tailleEntreprise ?? '',
      description: entreprise?.description ?? '',
      siteWeb: entreprise?.siteWeb ?? '',
      emailContact: entreprise?.emailContact ?? '',
      telephone: entreprise?.telephone ?? '',
      adresse: entreprise?.adresse ?? '',
      ville: entreprise?.ville ?? '',
      pays: entreprise?.pays ?? '',
      logoUrl: entreprise?.logo ? `/api/files/logo?entrepriseId=${entreprise.id}` : null,
      // Bascule à chaque écriture sur la ligne : cache-buster déterministe
      // du <img> sans état local (même mécanique que l'avatar candidat).
      logoUpdatedAt: entreprise ? entreprise.updatedAt.toISOString() : '',
      isVerified: entreprise?.isVerified ?? false,
    },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}
