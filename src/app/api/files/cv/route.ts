import { auth } from '@/auth'
import { logCvAccess } from '@/lib/audit'
import { ACTION_AUDIT_CONSULTATION, journaliserCandidature } from '@/lib/candidature-audit'
import type { Role } from '@/lib/definitions'
import { prisma } from '@/lib/prisma'
import { downloadMeta, signDownloadUrl } from '@/lib/storage'
import { NextResponse, type NextRequest } from 'next/server'

// ─── Téléchargement d'un CV : profil (Étape 2) OU pièce jointe figée (M7) ───
//
// GET /api/files/cv  →  302 vers une URL signée R2 (5 min).
// DEUX paramètres MUTUELLEMENT EXCLUSIFS, exactement UN requis :
// - ?candidatId=<id>   →  CV de PROFIL (`candidat.cvPath`) — inchangé ;
// - ?candidature=<id>  →  la PIÈCE JOINTE FIGÉE de la candidature
//   (`candidature.cvPath`, snapshot M7) : « le CV rattaché à une candidature
//   reste accessible même si le candidat modifie son profil » — le snapshot
//   servi est celui de LA LIGNE, jamais le cvPath actuel du profil.
//
// Réponses (JSON, car le Proxy Next.js exclut /api/* de son contrôle) :
// - 400  paramètre absent, présent deux fois, ou invalide (regex stricte)
// - 401  non connecté (le « visiteur demandant une URL CV » est REFUSÉ ici,
//        avant toute lecture de base)
// - 404  cible ou fichier introuvable — dans UN cas comme dans l'autre :
//        ligne absente ET clé absente (cvPath NULL) partagent le même code
//        et le même message : AUCUNE fuite d'existence
// - 403  refus de la matrice ci-dessous — DÉROGATION DOCUMENTÉE (revue
//        finale M7, arbitré : conservé). Les pages M5/M6/M7 répondent
//        404 strict ; ICI le 403 reste tel quel de la matrice d'accès
//        M3/M4 validée à l'Étape 2 (« 403 = refus de la matrice »),
//        verrouillée par ses tests. Conséquence assumée : 403 ⇒ « cette
//        ligne existe et porte une pièce jointe » (oracle résiduel,
//        derrière une session authentifiée). Dans les DEUX cas, le
//        contenu n'est JAMAIS diffusé avant contrôle.
//
// MATRICE `?candidatId=` (M10 : l'admin n'a AUCUN accès aux CV ; la règle de
// lecture justifiée ne s'applique qu'aux recruteurs liés par une candidature) :
// | Acteur     | Condition                                | Résultat |
// |------------|------------------------------------------|----------|
// | visiteur   | aucun                                     | 401      |
// | candidat   | son propre profil (userId)               | 302      |
// | candidat   | CV d'un autre candidat                   | 403      |
// | recruteur  | candidat postulé à UNE de ses offres      | 302      |
// | recruteur  | aucune candidature à ses offres           | 403      |
// | admin      | toujours                                 | 403      |
//
// MATRICE `?candidature=` (M7) — le contrôle porte sur LA LIGNE de
// candidature, relue en base en UNE seule requête (snapshot, propriétaire,
// offre employeuse) :
// | Acteur     | Condition                                       | Résultat |
// |------------|--------------------------------------------------|----------|
// | visiteur   | aucun                                            | 401      |
// | candidat   | la candidature lui appartient (candidat.userId)  | 302      |
// | candidat   | candidature d'un autre candidat                  | 403      |
// | recruteur  | la candidature vise UNE de ses offres            | 302      |
// | recruteur  | aucune de ses offres                             | 403      |
// | admin      | toujours                                         | 403      |
//
// Journal : recruteur UNIQUEMENT, écrit AVANT toute diffusion —
// fail-closed : sans trace, pas d'URL signée ; la cible consignée est le
// CANDIDAT propriétaire de la ligne. Le mode `?candidature=` écrit DEUX
// traces dans ce cas, dans cet ordre : le journal d’accès (AccesFichier) puis
// la ligne `consultation` d’AuditCandidature (src/lib/candidature-audit.ts,
// acteur = userId du recruteur) — échec de l’une ou de l’autre ⇒ aucune
// URL signée. AUCUNE écriture AuditCandidature en mode `?candidatId=` (profil
// : pas de `candidatureId` possible, colonne non nullable) ni quand le
// propriétaire candidat lit sa propre pièce jointe (le propriétaire n’est pas
// un événement sensible, comme pour logCvAccess).
//
// La redirection ne porte aucun Cache-Control par défaut sur certains
// intermédiaires : `private, no-store` est posé sur la réponse elle-même pour
// qu'aucun proxy ne réutilise une URL signée périmée auprès d'un autre client.
// ---------------------------------------------------------------------------

/**
 * Entier strict positif, commun aux deux modes : la regex exclut virgules,
 * signes et zéros initiaux que `parseInt` tronquerait silencieusement.
 */
const STRICT_POSITIVE_INT = /^[1-9][0-9]*$/

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * 302 vers l'URL signée de 5 minutes : aucun objet accessible publiquement,
 * aucune URL permanente ne quitte jamais le serveur. Les en-têtes anti-cache
 * sont posés sur la redirection elle-même (communs aux deux modes) pour
 * qu'aucun intermédiaire ne réutilise une URL périmée auprès d'un autre client.
 */
async function redirectSigned(key: string, filenameBase: string): Promise<NextResponse> {
  const { extension, contentType } = downloadMeta(key, 'pdf')
  const url = await signDownloadUrl({
    key,
    filename: `${filenameBase}.${extension}`,
    contentType,
  })

  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

/**
 * Mode `?candidatId=` — CV de PROFIL (matrice Étape 2, inchangée).
 * `raw` est déjà connu non nul ; il reste à valider sa forme strictement.
 */
async function serveProfil(raw: string, userId: number, role: Role): Promise<NextResponse> {
  // Paramètre strict : entier strict positif (sinon 400, pas de requête base).
  if (!STRICT_POSITIVE_INT.test(raw)) {
    return jsonError('Paramètre invalide.', 400)
  }
  const candidatId = Number.parseInt(raw, 10)

  const candidat = await prisma.candidat.findUnique({
    where: { id: candidatId },
    select: { id: true, userId: true, cvPath: true },
  })
  if (!candidat || !candidat.cvPath) {
    return jsonError('Fichier introuvable.', 404)
  }

  // Matrice d'accès — évaluation en base, jamais depuis le payload client
  // (un champ `role`/`id` forgeé dans la requête n'est pas lu ici).
  let allowed = false
  if (role === 'candidat') {
    allowed = candidat.userId === userId
  } else if (role === 'recruteur') {
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
    return jsonError('Accès refusé.', 403)
  }

  // Journal (matrice Étape 2) : recruteur UNIQUEMENT, écrit AVANT
  // toute diffusion — fail-closed : sans trace, pas d'URL signée.
  if (role !== 'candidat') {
    await logCvAccess(userId, candidat.id)
  }

  return redirectSigned(candidat.cvPath, `cv-${candidat.id}`)
}

/**
 * Mode `?candidature=` — pièce jointe FIGÉE de la ligne (snapshot M7).
 * Lecture UNIQUE : la ligne, son propriétaire et son offre employeuse sont
 * chargés ensemble ; aucun second aller-retour ne décide du contrôle.
 */
async function serveCandidature(raw: string, userId: number, role: Role): Promise<NextResponse> {
  // Même validation que `candidatId` : entier strict positif, sinon 400 sans
  // requête base.
  if (!STRICT_POSITIVE_INT.test(raw)) {
    return jsonError('Paramètre invalide.', 400)
  }
  const candidatureId = Number.parseInt(raw, 10)

  const candidature = await prisma.candidature.findUnique({
    where: { id: candidatureId },
    select: {
      id: true,
      cvPath: true,
      candidat: { select: { id: true, userId: true } },
      offre: { select: { entreprise: { select: { userId: true } } } },
    },
  })
  // 404 strict, INDISCERNABLE : ligne absente et candidature sans pièce
  // jointe (cvPath NULL) renvoient le même code et le même message —
  // aucune fuite d'existence.
  if (!candidature || !candidature.cvPath) {
    return jsonError('Fichier introuvable.', 404)
  }

  // Matrice d'accès — évaluation en base depuis LA LIGNE, jamais depuis le
  // payload client.
  let allowed = false
  if (role === 'candidat') {
    allowed = candidature.candidat.userId === userId
  } else if (role === 'recruteur') {
    // recruteur : la candidature vise UNE de SES offres (entreprise du
    // recruteur connecté) — le lien est lu sur la ligne, pas déduit.
    allowed = candidature.offre.entreprise.userId === userId
  }
  if (!allowed) {
    return jsonError('Accès refusé.', 403)
  }

  // Journal (M7, mêmes règles que le profil) : recruteur UNIQUEMENT,
  // écrit AVANT toute diffusion — fail-closed : sans trace, pas d'URL signée.
  // La cible consignée est le CANDIDAT propriétaire de la ligne.
  if (role !== 'candidat') {
    await logCvAccess(userId, candidature.candidat.id)
    // Ligne `consultation` (V3-I) : APRÈS le journal d’accès, AVANT la
    // signature — un échec interdit toute URL, comme logCvAccess. Le
    // propriétaire candidat n’écrit rien (branche exclue ci-dessus).
    await journaliserCandidature(prisma, {
      candidatureId,
      acteurId: userId,
      action: ACTION_AUDIT_CONSULTATION,
      ancienStatut: null,
      nouveauStatut: null,
    })
  }

  // Le fichier servi est le SNAPSHOT de la ligne, pas le cvPath du profil.
  return redirectSigned(candidature.cvPath, `cv-candidature-${candidature.id}`)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Authentification AVANT toute lecture (aucune requête base en 401).
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return jsonError('Authentification requise.', 401)
  }

  // 2. Paramètres mutuellement exclusifs : exactement UN requis. Les deux
  //    présents ou les deux absents → même 400, sans requête base.
  const candidatParam = request.nextUrl.searchParams.get('candidatId')
  const candidatureParam = request.nextUrl.searchParams.get('candidature')
  if (candidatParam !== null) {
    if (candidatureParam !== null) {
      return jsonError('Paramètre invalide.', 400)
    }
    return serveProfil(candidatParam, userId, role)
  }
  if (candidatureParam === null) {
    return jsonError('Paramètre invalide.', 400)
  }
  return serveCandidature(candidatureParam, userId, role)
}
