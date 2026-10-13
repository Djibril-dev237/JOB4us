import { NextResponse, type NextRequest } from 'next/server'

import { auth } from '@/auth'
import { chargerConversation, lireMessagesParCurseur } from '@/lib/messagerie-dal'
import { estLectureSeule } from '@/lib/messagerie-labels'
import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import { prisma } from '@/lib/prisma'
import type { ReponseActualisation } from '@/lib/souscription'

// ─── GET /api/messagerie/actualiser ──────────────────────────────────────────
//
// Point d'entrée du POLLING du fil de conversation (M8, Vague 2) : le
// transport ne transporte que « il y a du nouveau » — le client re-tire
// ici la DERNIÈRE PAGE de messages, jamais l'inverse. ZÉCRITURE : aucun
// avancerLecture (c'est l'action client qui accuse réception), aucune
// mutation — une route de lecture peut être rappelée par un abonnement,
// elle doit rester idempotente.
//
// Sécurité, dans l'ordre :
//  1. session (miroir de src/app/api/files/cv/route.ts) : sans session →
//     401 AVANT toute lecture base ;
//  2. rôle candidat/recruteur UNIQUEMENT : un admin n'a pas de boîte —
//     il reçoit la MÊME 404 que n'importe quel non-participant ;
//  3. `chargerConversation` porte le contrôle de participation dans SON
//     where : `null` → 404, corps IDENTIQUE à une conversation
//     inexistante (404 indiscernable, aucune énumération possible de
//     /messages/1, 2, 3…).
//
// Réponse 200 : la dernière page (≤ 30, ASC, ISO) + les trois drapeaux
// d'état dont le client a besoin pour re-rendre son bandeau sans second
// aller-retour. `lectureSeule` agrège statut terminal ET blocage (les
// deux sens) : le client détecte ainsi une fermeture survenue pendant
// l'absence et recharge une seule fois.
// ---------------------------------------------------------------------------

/**
 * Entier strict — regex, pas parseInt : `1.5`, `-1`, `+1`, `01` ou vide
 * sont rejetés sans requête base (parseInt tronquerait silencieusement).
 */
const ENTIER_STRICT = /^\d+$/

function jsonErreur(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // 1. Session avant toute lecture (aucune requête base en 401).
  const session = await auth()
  const userId = session?.user?.id
  const role = session?.user?.role
  if (typeof userId !== 'number' || !role) {
    return jsonErreur('Authentification requise.', 401)
  }

  // 2. Paramètre strict, sans requête base.
  const brut = request.nextUrl.searchParams.get('conversationId')
  if (brut === null || !ENTIER_STRICT.test(brut)) {
    return jsonErreur('requete', 400)
  }
  const conversationId = Number.parseInt(brut, 10)
  // Hors Int32 : Prisma lèverait `PrismaClientValidationError` hors de
  // toute gestion (500 au lieu d'un verdict) — requête mal formée, aucune
  // touche la base (critère M8 « zéro 500 »).
  if (conversationId > MAX_IDENTIFIANT) {
    return jsonErreur('requete', 400)
  }

  // 3. Rôles admis : l'admin (ni candidat ni recruteur) n'a pas de boîte —
  //    il reçoit la 404 « introuvable », indiscernable de la 404 d'un
  //    non-participant.
  if (role !== 'candidat' && role !== 'recruteur') {
    return jsonErreur('introuvable', 404)
  }

  // 4. Participation portée par la LECTURE (where du DAL) : null = 404
  //    indiscernable, que la conversation n'existe pas ou qu'elle n'est
  //    pas la mienne.
  const conversation = await chargerConversation(conversationId, userId)
  if (conversation === null) {
    return jsonErreur('introuvable', 404)
  }

  // 5. Blocage, dans l'UN ou l'AUTRE sens (2 lectures bornées) : la ligne
  //    trouvée dit QUI a bloqué, d'où les deux drapeaux.
  const blocage = await prisma.blocage.findFirst({
    where: {
      OR: [
        { bloqueurId: userId, bloqueId: conversation.autre.userId },
        { bloqueurId: conversation.autre.userId, bloqueId: userId },
      ],
    },
    select: { bloqueurId: true },
  })
  const bloqueeParMoi = blocage !== null && blocage.bloqueurId === userId
  const bloqueeParAutre = blocage !== null && blocage.bloqueurId !== userId

  // 6. Dernière page (curseur null) : le client fusionne par `id` avec son
  //    état — inutile de lui renvoyer l'historique complet.
  const page = await lireMessagesParCurseur(conversationId, userId, null)
  if (page === null) {
    // Conversation disparue entre les deux lectures : même 404 corps que
    // l'absence (indiscernable, aucune fuite).
    return jsonErreur('introuvable', 404)
  }

  const reponse: ReponseActualisation = {
    ok: true,
    messages: page.messages.map((message) => ({
      id: message.id,
      contenu: message.contenu,
      emetteurId: message.emetteurId,
      createdAt: message.createdAt.toISOString(),
    })),
    aPlusAncien: page.aPlusAncien,
    lectureSeule:
      estLectureSeule(conversation.statutCandidature) || bloqueeParMoi || bloqueeParAutre,
    bloqueeParMoi,
    bloqueeParAutre,
  }

  const reponseHttp = NextResponse.json(reponse)
  // Le polling ne doit jamais être servi depuis un cache intermédiaire :
  // une page de messages figée ferait « croire » au client qu'il n'y a
  // rien de nouveau, indéfiniment.
  reponseHttp.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return reponseHttp
}
