import { z } from 'zod'

import { MAX_IDENTIFIANT } from '@/lib/messagerie-schemas'
import {
  DECISIONS_SIGNALEMENT,
  MOTIFS_ACCES_CONVERSATION,
  MOTIFS_DECISION_SIGNALEMENT,
  MOTIFS_RETABLISSEMENT,
} from '@/lib/moderation-labels'

// ─── Schémas des actions de modération (M10) ─────────────────────────────────
//
// Même doctrine que les schémas M8 : la forme est validée au bord du serveur,
// les clés inconnues sont refusées, les valeurs sensibles ne sont jamais lues
// depuis un objet brut. Les catalogues fermés de moderation-labels.ts sont la
// seule source des décisions et des motifs.
// ---------------------------------------------------------------------------

const NOTE_MAX = 2000

const noteInterne = z.string().max(NOTE_MAX).optional()

export const schemaAccesConversation = z
  .object({
    signalementId: z.number().int().positive().max(MAX_IDENTIFIANT),
    motif: z.enum(MOTIFS_ACCES_CONVERSATION),
  })
  .strict()

export type AccesConversationData = z.infer<typeof schemaAccesConversation>

export const schemaDecisionSignalement = z
  .object({
    signalementId: z.number().int().positive().max(MAX_IDENTIFIANT),
    decision: z.enum(DECISIONS_SIGNALEMENT),
    motif: z.enum(MOTIFS_DECISION_SIGNALEMENT),
    noteInterne,
  })
  .strict()

export type DecisionSignalementData = z.infer<typeof schemaDecisionSignalement>

export const schemaRetablissementMessage = z
  .object({
    messageId: z.number().int().positive().max(MAX_IDENTIFIANT),
    motif: z.enum(MOTIFS_RETABLISSEMENT),
    noteInterne,
  })
  .strict()

export type RetablissementMessageData = z.infer<typeof schemaRetablissementMessage>
