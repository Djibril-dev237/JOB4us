import { auth } from '@/auth'
import { logCvAccess } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { downloadMeta, signDownloadUrl } from '@/lib/storage'
import { NextResponse, type NextRequest } from 'next/server'

// ─── Téléchargement d'un CV (matrice d'accès de l'Étape 2, validée) ──────────
//
// GET /api/files/cv?candidatId=<id>  →  302 vers une URL signée R2 (5 min).
//
// Réponses (JSON, car le Proxy Next.js exclut /api/* de son contrôle) :
// - 400  paramètre invalide
// - 401  non connecté (le « visiteur demandant une URL CV » est REFUSÉ ici,
//        avant toute lecture de base)
// - 404  candidat ou CV inexistant (aucun détail sur l'existence d'un fichier
//        consultable : même code pour les deux cas)
// - 403  refus de la matrice ci-dessous
//
// MATRICE (rappel — seul l'admin est élargi par la règle « lecture
// justifiée » ; l'annuaire recruteur supprimé n'offre aucun autre chemin) :
// | Acteur     | Condition                                | Résultat |
// |------------|------------------------------------------|----------|
// | visiteur   | aucun                                     | 401      |
// | candidat   | son propre profil (userId)               | 302      |
// | candidat   | CV d'un autre candidat                   | 403      |
// | recruteur  | candidat postulé à UNE de ses offres      | 302      |
// | recruteur  | aucune candidature à ses offres           | 403      |
// | admin      | toujours                                 | 302      |
//
// La redirection ne porte aucun Cache-Control par défaut sur certains
// intermédiaires : `private, no-store` est posé sur la réponse elle-même pour
// qu'aucun proxy ne réutilise une URL signée périmée auprès d'un autre client.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Authentification AVANT toute lecture (aucune requête base en 401).
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 })
  }

  // 2. Paramètre strict : entier positif (sinon 400, pas de requête base).
  const raw = request.nextUrl.searchParams.get('candidatId') ?? ''
  const candidatId = Number.parseInt(raw, 10)
  if (!Number.isInteger(candidatId) || candidatId <= 0) {
    return NextResponse.json({ error: 'Paramètre invalide.' }, { status: 400 })
  }

  const candidat = await prisma.candidat.findUnique({
    where: { id: candidatId },
    select: { id: true, userId: true, cvPath: true },
  })
  if (!candidat || !candidat.cvPath) {
    return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 })
  }

  // 3. Matrice d'accès — évaluation en base, jamais depuis le payload client
  //    (un champ `role`/`id` forgeé dans la requête n'est pas lu ici).
  let allowed = false
  if (role === 'admin') {
    allowed = true
  } else if (role === 'candidat') {
    allowed = candidat.userId === userId
  } else {
    // recruteur : existence d'une candidature de CE candidat à UNE offres de
    // CE recruteur (entreprise du recruteur connecté), indépendamment du
    // statut (accès maintenu tant que la candidature existe — Étape 2).
    const candidature = await prisma.candidature.findFirst({
      where: { candidatId: candidat.id, offre: { entreprise: { userId } } },
      select: { id: true },
    })
    allowed = candidature !== null
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 })
  }

  // 4. Journal (matrice Étape 2) : recruteur ou admin UNIQUEMENT, écrit AVANT
  //    toute diffusion — fail-closed : sans trace, pas d'URL signée.
  if (role !== 'candidat') {
    await logCvAccess(userId, candidat.id)
  }

  // 5. URL signée de 5 minutes : aucun objet accessible publiquement, aucune
  //    URL permanente ne quitte jamais le serveur.
  const { extension, contentType } = downloadMeta(candidat.cvPath, 'pdf')
  const url = await signDownloadUrl({
    key: candidat.cvPath,
    filename: `cv-${candidat.id}.${extension}`,
    contentType,
  })

  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return response
}
