import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { DISPONIBILITE_VERS_FORM } from '@/lib/definitions'
import { NextResponse } from 'next/server'

// ─── API : profil du candidat connecté ───────────────────────────────────────
// Alimente <ProfilForm /> : la page /candidat/profil doit rester synchrone
// (règle de suspension #98097), les données viennent donc d'un route handler.
//
// SÉCURITÉ :
// - 401 non connecté, 403 hors rôle candidat (les espaces recruteur/admin ont
//   leurs propres pages — M3-ST9/plus tard) : AUCUNE lecture possible d'un
//   profil tiers, il n'existe qu'un chemin « moi » ;
// - aucune clé R2 ni URL signée ne quitte ce handler : l'avatar est référencé
//   par notre propre route /api/files/avatar (matrice appliquée à chaque
//   appel), le CV par un simple booléen `hasCv` ;
// - Cache-Control: private, no-store — jamais de profil en cache partagé.
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }
  if (role !== 'candidat') {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  const [user, candidat, competences] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, phone: true, ville: true, avatar: true, updatedAt: true },
    }),
    prisma.candidat.findUnique({
      where: { userId },
      select: {
        id: true,
        titreProfil: true,
        resume: true,
        dateNaissance: true,
        genre: true,
        disponibilite: true,
        cvPath: true,
        competences: { select: { competenceId: true } },
      },
    }),
    prisma.competence.findMany({
      orderBy: { nom: 'asc' },
      select: { id: true, nom: true },
    }),
  ])

  if (!user || !candidat) {
    return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 })
  }

  return NextResponse.json(
    {
      candidatId: candidat.id,
      name: user.name,
      phone: user.phone ?? '',
      ville: user.ville ?? '',
      avatarUrl: user.avatar ? `/api/files/avatar?userId=${userId}` : null,
      // Bascule à chaque écriture sur le compte (y compris l'avatar) : sert
      // de « cache-buster » déterministe pour le <img> sans état local.
      avatarUpdatedAt: user.updatedAt.toISOString(),
      titreProfil: candidat.titreProfil ?? '',
      resume: candidat.resume ?? '',
      // Colonne @db.Date : minuit UTC → 'AAAA-MM-JJ' stable (pas de décalage
      // de fuseau : jamais de toISOString() sur un horodatage local ici).
      dateNaissance: candidat.dateNaissance ? candidat.dateNaissance.toISOString().slice(0, 10) : '',
      genre: candidat.genre ?? '',
      disponibilite: candidat.disponibilite
        ? DISPONIBILITE_VERS_FORM[candidat.disponibilite]
        : '',
      competences: candidat.competences.map((lien) => lien.competenceId),
      hasCv: candidat.cvPath !== null,
      competencesDisponibles: competences,
    },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}
