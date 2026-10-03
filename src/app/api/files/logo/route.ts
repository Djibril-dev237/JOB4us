import { NextResponse, type NextRequest } from 'next/server'

import { auth } from '@/auth'
import { entrepriseAOffreVisible } from '@/lib/offres-public'
import { prisma } from '@/lib/prisma'
import { downloadMeta, signDownloadUrl } from '@/lib/storage'

// ─── Téléchargement d'un logo d'entreprise (matrice M5 : option B) ──────────
//
// GET /api/files/logo?entrepriseId=<id>  →  302 vers une URL signée R2 (5 min).
//
// | Acteur     | Condition                                  | Résultat |
// |------------|--------------------------------------------|----------|
// | visiteur   | entreprise + logo + AU MOINS 1 offre visible | 302     |
// | visiteur   | sinon (inexistante / sans logo / sans offre) | 404    |
// | recruteur  | son propre logo                             | 302     |
// | recruteur  | logo d'une autre entreprise                 | 403     |
// | admin      | toujours                                    | 302     |
//
// JUSTIFICATION du public : ce n'est plus un effet de bord mais la décision
// explicite du module offres (M5, option B validée en étape 3). Le logo
// n'est diffusé publiquement QUE si l'entreprise a au moins une offre
// visible (entrepriseAOffreVisible = prédicat unique de la DAL) : le
// comportement fail-closed d'avant est conservé pour toute entreprise sans
// offre affichable (404, aucune fuite d'existence). Le legacy, lui, servait
// TOUS les logos en clair depuis /storage/logos (URL devinable, constat
// d'étape 1).
//
// Paramètre validé AVANT l'authentification : le 400 ne dépend d'aucune
// session et n'effectue aucune lecture base.
// Cache : la branche publique est cachée 5 minutes (= durée de la
// signature — le navigateur ne re-signe pas à chaque image) ; la branche
// authentifiée reste no-store (matrice M3 inchangée). `inline` justifié
// comme pour l'avatar (raster blanchi, MIME réel, nosniff).
// ---------------------------------------------------------------------------

async function reponseLogo(
  targetId: number,
  key: string,
  options: { publique: boolean },
): Promise<NextResponse> {
  const { extension, contentType } = downloadMeta(key, 'png')
  const url = await signDownloadUrl({
    key,
    filename: `logo-${targetId}.${extension}`,
    contentType,
    disposition: 'inline',
  })

  const response = NextResponse.redirect(url, 302)
  response.headers.set(
    'Cache-Control',
    options.publique ? 'public, max-age=300' : 'private, no-store, max-age=0',
  )
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Paramètre strict : entier strict positif (regex, cf. routes CV/avatar),
  //    vérifié avant toute session ou lecture base.
  const raw = request.nextUrl.searchParams.get('entrepriseId') ?? ''
  if (!/^[1-9][0-9]*$/.test(raw)) {
    return NextResponse.json({ error: 'Paramètre invalide.' }, { status: 400 })
  }
  const targetId = Number.parseInt(raw, 10)

  // 2. Session éventuelle — la branche publique est décidée juste après.
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role

  // 3. Lecture unique de l'entreprise (les deux branches partagent la ligne).
  const target = await prisma.entreprise.findUnique({
    where: { id: targetId },
    select: { logo: true, userId: true },
  })
  if (!target || !target.logo) {
    return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  }

  if (typeof userId === 'number' && role) {
    // 4a. Matrice authentifiée (M3, inchangée) : propriétaire OU admin.
    const allowed = role === 'admin' || target.userId === userId
    if (!allowed) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
    }
    return reponseLogo(targetId, target.logo, { publique: false })
  }

  // 4b. Branche publique (option B) : conditionnée à une offre visible.
  if (!(await entrepriseAOffreVisible(targetId))) {
    return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  }
  return reponseLogo(targetId, target.logo, { publique: true })
}
