import 'server-only'

import { prisma } from '@/lib/prisma'

// ─── Journal d'accès aux fichiers sensibles ──────────────────────────────────
// Politique (matrice Étape 2 validée) :
// - SEULEMENT les lectures de CV effectuées par un recruteur ou un admin
//   sont journalisées (le propriétaire accédant à son propre fichier n'est
//   pas un événement sensible) ;
// - le journal est une CONDITION de la diffusion : l'écriture est attendue
//   (await) AVANT la redirection, sur le même pool MySQL que le contrôle
//   d'accès lui-même — si la base est joignable pour autoriser, elle l'est
//   pour consigner ; en cas d'échec, aucune URL signée n'est produite
//   (fail-closed : pas de trace, pas de diffusion) ;
// - table append-only sans clé étrangère (cf. schema.prisma) : la trace
//   survit à toute suppression de compte.
// ---------------------------------------------------------------------------

/**
 * Consigne une lecture effective d'un CV par `acteurId` (recruteur ou admin).
 * Ne renvoie rien : toute erreur interdit implicitement la diffusion
 * (appelée avant la génération de l'URL signée).
 */
export async function logCvAccess(acteurId: number, cibleCandidatId: number): Promise<void> {
  await prisma.accesFichier.create({
    data: { acteurId, cibleCandidatId },
  })
}
