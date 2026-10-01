import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { downloadMeta, signDownloadUrl } from '@/lib/storage'
import { NextResponse, type NextRequest } from 'next/server'

// ─── Téléchargement d'un logo d'entreprise (matrice Étape 2, appliquée) ──────
//
// GET /api/files/logo?entrepriseId=<id>  →  302 vers une URL signée R2 (5 min).
//
// MATRICE conservatrice (fail-closed, même esprit que l'avatar) :
// | Acteur     | Condition                         | Résultat |
// |------------|-----------------------------------|----------|
// | visiteur   | aucun                              | 401      |
// | recruteur  | son propre logo                    | 302      |
// | recruteur  | logo d'une autre entreprise        | 403      |
// | admin      | toujours                           | 302      |
//
// JUSTIFICATION du refus PUBLIC : le legacy servait les logos en clair depuis
// /storage/logos (URL devinable — constat d'étape 1). Le logo étant un
// affichage marketing, élargir à « public » serait possible MAIS c'est une
// décision explicite à prendre au module d'affichage des offres — jamais un
// effet de bord d'une route de fichiers. En attendant : propriétaire+admin.
// `inline` justifié comme pour l'avatar (raster blanchi, MIME réel, nosniff).
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Authentification AVANT toute lecture.
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  // 2. Paramètre strict : entier strict positif (regex, cf. routes CV/avatar).
  const raw = request.nextUrl.searchParams.get('entrepriseId') ?? ''
  if (!/^[1-9][0-9]*$/.test(raw)) {
    return NextResponse.json({ error: 'Paramètre invalide.' }, { status: 400 })
  }
  const targetId = Number.parseInt(raw, 10)

  const target = await prisma.entreprise.findUnique({
    where: { id: targetId },
    select: { logo: true, userId: true },
  })
  if (!target || !target.logo) {
    return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  }

  // 3. Matrice : propriétaire de l'entreprise OU admin, rien d'autre.
  const allowed = role === 'admin' || target.userId === userId
  if (!allowed) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  // 4. URL signée de 5 minutes (jamais d'URL publique permanente).
  const { extension, contentType } = downloadMeta(target.logo, 'png')
  const url = await signDownloadUrl({
    key: target.logo,
    filename: `logo-${targetId}.${extension}`,
    contentType,
    disposition: 'inline',
  })

  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}
