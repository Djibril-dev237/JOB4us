import { Badge } from '@/components/ui/badge'
import {
  LIBELLES_STATUT,
  VARIANTE_STATUT,
  type StatutAffiche,
} from '@/lib/offres-labels'

// ─── Badge de statut d'une offre (M6, préalable P2) ──────────────────────────
// Présentation pure : ni hook, ni directive 'use client', ni calcul —
// utilisable tel quel par les pages serveur (liste, aperçu, admin) ET par
// les composants clients (filtres, formulaire). Le statut lui-même est
// DÉRIVÉ côté serveur via statutAffiche() (D12) puis passé en prop : ce
// composant n'affiche que, jamais il ne décide.
// Variants verrouillés par offres-labels.test.ts (étape 3).
// ---------------------------------------------------------------------------

interface StatutBadgeProps {
  statut: StatutAffiche
  className?: string
}

export function StatutBadge({ statut, className }: StatutBadgeProps) {
  return (
    <Badge variant={VARIANTE_STATUT[statut]} className={className}>
      {LIBELLES_STATUT[statut]}
    </Badge>
  )
}
