import { z } from 'zod'

import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import {
  MOTIFS_SUSPENSION_OFFRE,
  MOTIFS_SUSPENSION_UTILISATEUR,
} from '@/lib/moderation-labels'

// ─── Schémas des actions de gestion admin (M10) ─────────────────────────────
// Même doctrine que les schémas M8/M10 : identifiant entier positif borné,
// motif issu d'un catalogue fermé, note bornée, clés inconnues refusées.
// ---------------------------------------------------------------------------

const identifiant = z.coerce.number().int().positive().max(MAX_IDENTIFIANT)
const noteInterne = z.string().trim().max(2000).optional()

export const schemaSuspensionUtilisateur = z
  .object({
    userId: identifiant,
    motif: z.enum(MOTIFS_SUSPENSION_UTILISATEUR),
    noteInterne,
  })
  .strict()

export type SuspensionUtilisateurData = z.infer<typeof schemaSuspensionUtilisateur>

export const schemaReactivationUtilisateur = z
  .object({
    userId: identifiant,
    motif: z.enum(MOTIFS_SUSPENSION_UTILISATEUR),
    noteInterne,
  })
  .strict()

export type ReactivationUtilisateurData = z.infer<typeof schemaReactivationUtilisateur>

export const schemaSuspensionOffre = z
  .object({
    offreId: identifiant,
    motif: z.enum(MOTIFS_SUSPENSION_OFFRE),
    noteInterne,
  })
  .strict()

export type SuspensionOffreData = z.infer<typeof schemaSuspensionOffre>

export const schemaReactivationOffre = z
  .object({
    offreId: identifiant,
    motif: z.enum(MOTIFS_SUSPENSION_OFFRE),
    noteInterne,
  })
  .strict()

export type ReactivationOffreData = z.infer<typeof schemaReactivationOffre>
