import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { downloadMeta, signDownloadUrl } from '@/lib/storage'
import { NextResponse, type NextRequest } from 'next/server'

// ─── Téléchargement d'une photo de profil (matrice Étape 2, validée) ─────────
//
// GET /api/files/avatar?userId=<id>  →  302 vers une URL signée R2 (5 min).
//
// MATRICE volontairement stricte :
// | Acteur     | Condition                        | Résultat |
// |------------|----------------------------------|----------|
// | visiteur   | aucun                             | 401      |
// | utilisateur| son propre avatar (userId)       | 302      |
// | utilisateur| avatar d'un autre compte         | 403      |
// | admin      | toujours                         | 302      |
//
// JUSTIFICATION du refus des tiers : aucune vue publique de profil n'existe
// (décision Étape 2 : « ne pas en créer ») et aucune page affiche aujourd'hui
// l'avatar d'autrui. La matrice ne s'élargit QUE par décision explicite et
// documentée (ex. futur module messagerie) — jamais par complaisance.
// Le paramètre `userId` reste malgré tout contrôlé : pas de requête base sur
// une valeur non entière.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Authentification AVANT toute lecture (aucune requête base en 401).
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  // 2. Paramètre strict : entier positif.
  const raw = request.nextUrl.searchParams.get('userId') ?? ''
  const targetId = Number.parseInt(raw, 10)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Paramètre invalide.' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { avatar: true },
  })
  if (!target || !target.avatar) {
    return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  }

  // 3. Matrice : propriétaire OU admin, rien d'autre.
  const allowed = role === 'admin' || targetId === userId
  if (!allowed) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  // 4. URL signée de 5 minutes (jamais d'URL publique permanente).
  const { extension, contentType } = downloadMeta(target.avatar, 'png')
  const url = await signDownloadUrl({
    key: target.avatar,
    filename: `avatar-${targetId}.${extension}`,
    contentType,
  })

  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}
