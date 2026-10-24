'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { LigneNotification } from '@/lib/notifications-dal'
import { TEXTES } from '@/lib/notifications-labels'

// ─── Une notification de la liste (/notifications, M9 Vague 2) ───────────────
//
// Composant CLIENT (boutons d'action), rendu UNIQUEMENT par
// <ListeNotifications> : il ne reçoit jamais de fonction depuis un composant
// serveur. Titre et contenu sont les TEXTES DÉJÀ FABRIQUÉS à l'émission
// (colonne `titre`/`contenu` de `Notification`) — jamais recomposés ici.
//
// Lien : `lien` n'est rendu en <Link> QUE s'il est INTERNE (commence par `/`,
// ni `//hote` protocol-relative, ni `\` — le navigateur normalise `\` en `/`).
// Toute autre valeur (URL absolue externe, `javascript:`…) est simplement
// ignorée : le titre reste du texte, jamais un lien sortant.
//
// Non-lu : barre visuelle à gauche (`border-brand`) + marqueur `sr-only`
// `TEXTES.statutNonLue` — l'information n'est jamais portée par la seule
// couleur. « Marquer comme lu » n'est rendu QUE si la carte est non lue : le
// DAL refuse (`isLu: false` dans le `where`) toute cible déjà lue, ce bouton
// ne promettrait donc qu'un 404.
//
// Tous les textes sortent de TEXTES (boutons, statut, badge) — aucun libellé
// local. La date est une DONNÉE (`createdAt`), formatée en fuseau du projet
// comme dans carte-conversation.tsx.
// ---------------------------------------------------------------------------

/** Horodatage court « JJ/MM/AAAA HH:MM », fuseau du projet (motif M6/M7/M8). */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

interface Props {
  notification: LigneNotification
  /** Une action de CETTE carte est en vol (double clic interdit). */
  enCours: boolean
  onMarquerLu: (notificationId: number) => void
  onSupprimer: (notificationId: number) => void
}

/**
 * Lien INTERNE autorisé : valeur présente, commence par `/`, ni `//hote`
 * (URL protocol-relative = externe) ni `\` (normalisée en `/` par le
 * navigateur). `javascript:`, `data:`, `https://…` et tout autre absolu ne
 * sortent jamais en `<Link>`.
 */
function lienInterne(lien: string | null): string | null {
  if (lien === null || !lien.startsWith('/')) return null
  if (lien.startsWith('//') || lien.includes('\\')) return null
  return lien
}

export function CarteNotification({ notification, enCours, onMarquerLu, onSupprimer }: Props) {
  const { id, titre, contenu, lien, isLu, compteur, createdAt } = notification
  const cible = lienInterne(lien)

  return (
    <li
      className={`flex min-w-0 flex-col gap-2 border-l-4 px-4 py-3 transition-colors duration-fast ${
        isLu ? 'border-transparent' : 'border-brand'
      }`}
    >
      {/* Marqueur non-lu : la barre porte la couleur, ce span porte le sens. */}
      {isLu ? null : <span className="sr-only">{TEXTES.statutNonLue}</span>}

      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="min-w-0 text-sm font-bold text-ink">
            {cible !== null ? (
              <Link
                href={cible}
                className="underline-offset-2 transition-colors duration-fast hover:text-brand hover:underline"
              >
                {titre}
              </Link>
            ) : (
              titre
            )}
          </h2>

          {contenu !== null ? (
            <p className="mt-1 min-w-0 break-words text-sm text-ink-muted">{contenu}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Badge de regroupement : UNIQUEMENT si compteur > 1, avec le
              nombre annoncé par `TEXTES.nonLues` au lecteur d'écran. */}
          {compteur > 1 ? (
            <Badge variant="accent">
              {compteur}
              <span className="sr-only">{TEXTES.nonLues}</span>
            </Badge>
          ) : null}

          <time dateTime={createdAt.toISOString()} className="text-xs text-ink-muted">
            {FORMATEUR_DATE.format(createdAt)}
          </time>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {isLu ? null : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={enCours}
            onClick={() => onMarquerLu(id)}
          >
            {TEXTES.boutonMarquerLu}
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={enCours}
          onClick={() => onSupprimer(id)}
        >
          {TEXTES.boutonSupprimer}
        </Button>
      </div>
    </li>
  )
}
