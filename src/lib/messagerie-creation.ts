import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

// ─── Création d'une conversation à partir d'une candidature (M8, Vague 2) ────
//
// Ce lib est appelé PAR une action (postulation M7 ou action de messagerie) —
// jamais exposé au client lui-même. Conséquences assumées :
//
//  * AUCUN contrôle de participant ici : les participants se DÉRIVENT de la
//    candidature par FK à chaque lecture (messagerie-dal.ts) — personne n'est
//    « invité » à la création, il n'y a donc rien à inviter ni à vérifier.
//    Vérifier ici reviendrait à figer une copie que la suite devrait
//    désynchroniser.
//  * AUCUNE gestion de verdict : ce module ne connaît ni verdict d'action,
//    ni redirect, ni clé d'erreur — il rend l'id créé ou `null` (candidature
//    absente). Le traduire en `?erreur=` ou en 404 appartient à l'action
//    appelante, seule détentrice du contexte utilisateur.
//  * UNE conversation PAR candidature (contrainte DB `@unique candidatureId`)
//    : la course entre deux appels simultanés (double clic, double onglet,
//    deux requêtes parallèles) se règle PAR la base, pas par un verrou
//    applicatif. Le second créateur reçoit P2002 et LIT la ligne gagnante :
//    le résultat est idempotent (même id renvoyé), aucune erreur ne remonte.
//    Toute AUTRE erreur (réseau, contrainte FK…) remonte telle quelle —
//    l'appelant décidera de son sort.
// ---------------------------------------------------------------------------

/**
 * Crée (ou retrouve en cas de course) la conversation rattachée à une
 * candidature.
 *
 * @param candidatureId candidature dont la conversation dérive
 * @returns l'id de la conversation, ou `null` si la candidature n'existe pas
 * @throws toute erreur DB autre que P2002 (réseau, FK…) remonte à l'appelant
 */
export async function creerConversationDepuisCandidature(
  candidatureId: number,
): Promise<number | null> {
  // La candidature doit exister : `null` → pas de conversation, aucun écrit.
  const candidature = await prisma.candidature.findUnique({
    where: { id: candidatureId },
    select: { id: true },
  })
  if (candidature === null) {
    return null
  }

  try {
    const conversation = await prisma.conversation.create({
      data: { candidatureId },
      select: { id: true },
    })
    return conversation.id
  } catch (erreur) {
    // Course : la contrainte d'unicité sur candidatureId a départagé les deux
    // créateurs. P2002 UNIQUEMENT — un autre code (P2003 FK, panne…) n'est
    // pas un doublon et ne doit jamais être converti en succès silencieux.
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      // Relecture de la ligne gagnante : c'est LE point de divergence du
      // contrat idempotent — on rend l'id déjà créé, jamais une seconde
      // conversation, jamais une erreur.
      const existante = await prisma.conversation.findUnique({
        where: { candidatureId },
        select: { id: true },
      })
      // `existante` ne peut plus être null en pratique (la ligne vient de
      // gagner la course), mais un null ici resterait un verdict honnête —
      // jamais d'exception inventée.
      return existante?.id ?? null
    }
    throw erreur
  }
}
