'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  chargerNotifications,
  marquerNotificationLu,
  supprimerNotification,
  toutMarquerLu,
} from '@/app/actions/notifications'
import { CarteNotification } from '@/components/notifications/carte-notification'
import { IconBell } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { PageNotifications } from '@/lib/notifications-dal'
import { TEXTES } from '@/lib/notifications-labels'

// ─── « Mes notifications » : liste, actions et « Charger plus » ──────────────
//
// Composant CLIENT, seul propriétaire de l'état de la liste côté navigateur
// (motif de fil-messages.tsx, M8) :
//
//  * lecture initiale fournie par la page serveur (`listerNotifications`),
//    pagination par curseur composite via `chargerNotifications` avec
//    APPEND + dédoublonnage par `id` (une page rejouée ne duplique rien) ;
//  * marquage « lu », suppression (confirmée) et « tout lire » passent par
//    les server actions M9 : chaque verdict net (`ok`, `null`) devient un
//    bandeau verbatim TEXTES, un rejet (dont `notFound()` de contrôle) devient
//    `TEXTES.actionEchouee` — JAMAIS d'exception qui propage depuis un clic ;
//  * l'état local est mis à jour PUIS `router.refresh()` relit la RSC : la
//    cloche du header (compteur serveur) se recalcule sans dupliquer la
//    vérité, la liste reste pilotée ici (un refresh ne remet pas l'état) ;
//  * aucun texte local : titres, boutons, états vides, bandeaux et libellé de
//    pagination sortent tous de `TEXTES`.
//
// `min-w-0` partout (colonne `max-w-3xl`, 360 px sans défilement horizontal).
// ---------------------------------------------------------------------------

/** Bandeau de succès (tokens M2, motif ALERTE_SUCCES des pages du dépôt). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus (tokens M2, motif ALERTE_ERREUR des pages du dépôt). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

interface Props {
  /** Première page, lue côté serveur (curseur `null`). */
  pageInitial: PageNotifications
}

/** Dernier identifiant connu → curseur `[createdAt ISO, id]` du schéma. */
function curseurDepuisLignes(
  notifications: PageNotifications['notifications'],
): { curseur: [string, number] } | null {
  const dernier = notifications[notifications.length - 1]
  if (dernier === undefined) return null
  return { curseur: [dernier.createdAt.toISOString(), dernier.id] }
}

type Retour = { variante: 'succes' | 'erreur'; texte: string }

export function ListeNotifications({ pageInitial }: Props) {
  const router = useRouter()

  const [notifications, setNotifications] = useState<
    PageNotifications['notifications']
  >(() => pageInitial.notifications)
  const [aPlusAncien, setAPlusAncien] = useState(pageInitial.aPlusAncien)
  const [enChargement, setEnChargement] = useState(false)
  /** Identifiant de la carte en vol, `'tout'` pour l'action globale. */
  const [enCours, setEnCours] = useState<number | 'tout' | null>(null)
  const [retour, setRetour] = useState<Retour | null>(null)
  /** Dernier « Charger plus » en échec : le bouton devient un essai de reprise. */
  const [chargementEchoue, setChargementEchoue] = useState(false)

  async function marquerLu(notificationId: number): Promise<void> {
    if (enCours !== null) return
    setEnCours(notificationId)
    setRetour(null)
    try {
      const resultat = await marquerNotificationLu({ notificationId })
      if (!resultat.ok) {
        setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
        return
      }
      setNotifications((precedentes) =>
        precedentes.map((ligne) =>
          ligne.id === notificationId ? { ...ligne, isLu: true } : ligne,
        ),
      )
      setRetour({ variante: 'succes', texte: TEXTES.marqueesLues })
      // Cloche du header : verdict serveur relu, jamais d'état dupliqué.
      router.refresh()
    } catch {
      // Réseau coupé, 404 de contrôle (notification disparue) : verdict net.
      setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
    } finally {
      setEnCours(null)
    }
  }

  async function supprimer(notificationId: number): Promise<void> {
    if (enCours !== null) return
    // Confirmation du repo : `window.confirm` + texte TEXTES uniquement.
    if (!window.confirm(TEXTES.confirmationSuppression)) return

    setEnCours(notificationId)
    setRetour(null)
    try {
      const resultat = await supprimerNotification({ notificationId })
      if (!resultat.ok) {
        setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
        return
      }
      setNotifications((precedentes) =>
        precedentes.filter((ligne) => ligne.id !== notificationId),
      )
      setRetour({ variante: 'succes', texte: TEXTES.notificationSupprimee })
      router.refresh()
    } catch {
      setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
    } finally {
      setEnCours(null)
    }
  }

  async function toutLire(): Promise<void> {
    if (enCours !== null) return
    setEnCours('tout')
    setRetour(null)
    try {
      const nombre = await toutMarquerLu()
      if (nombre === null) {
        setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
        return
      }
      setNotifications((precedentes) =>
        precedentes.map((ligne) => (ligne.isLu ? ligne : { ...ligne, isLu: true })),
      )
      setRetour({ variante: 'succes', texte: TEXTES.marqueesLues })
      router.refresh()
    } catch {
      setRetour({ variante: 'erreur', texte: TEXTES.actionEchouee })
    } finally {
      setEnCours(null)
    }
  }

  async function chargerPlus(): Promise<void> {
    const curseur = curseurDepuisLignes(notifications)
    if (enChargement || curseur === null) return

    setEnChargement(true)
    setChargementEchoue(false)
    setRetour(null)
    try {
      const page = await chargerNotifications(curseur)
      if (page === null) {
        setChargementEchoue(true)
        setRetour({ variante: 'erreur', texte: TEXTES.erreurChargement })
        return
      }
      // Append + dédoublonnage par `id` : une page rejouée n'ajoute rien.
      setNotifications((precedentes) => {
        const connus = new Set(precedentes.map((ligne) => ligne.id))
        return [...precedentes, ...page.notifications.filter((ligne) => !connus.has(ligne.id))]
      })
      setAPlusAncien(page.aPlusAncien)
    } catch {
      setChargementEchoue(true)
      setRetour({ variante: 'erreur', texte: TEXTES.erreurChargement })
    } finally {
      setEnChargement(false)
    }
  }

  const vide = notifications.length === 0

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Retours d'action : verbatim TEXTES, `role` selon la variante. */}
      {retour !== null ? (
        <p
          role={retour.variante === 'erreur' ? 'alert' : 'status'}
          className={retour.variante === 'erreur' ? CLASSE_ERREUR : CLASSE_SUCCES}
        >
          {retour.texte}
        </p>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={enCours !== null}
          onClick={() => void toutLire()}
        >
          {TEXTES.boutonToutLire}
        </Button>
      </div>

      {vide ? (
        <Card className="text-center">
          <div className="py-8">
            <IconBell size={40} className="mx-auto text-brand opacity-25" />
            <div className="mt-4 text-sm font-medium text-ink">{TEXTES.listeVide}</div>
            <Link
              href="/offres"
              className="mt-3 inline-flex items-center text-sm font-medium text-brand underline-offset-2 hover:underline"
            >
              {TEXTES.lienListeVide}
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="min-w-0 divide-y divide-line rounded-md border border-line bg-surface shadow-card">
          {notifications.map((notification) => (
            <CarteNotification
              key={notification.id}
              notification={notification}
              enCours={enCours === notification.id}
              onMarquerLu={(id) => void marquerLu(id)}
              onSupprimer={(id) => void supprimer(id)}
            />
          ))}
        </ul>
      )}

      {/* Pagination : <nav> nommée `TEXTES.pagination`, une seule page
          affichée n'affiche AUCUN conteneur (motif de pagination.tsx M7). */}
      {!vide && aPlusAncien ? (
        <nav aria-label={TEXTES.pagination} className="flex min-w-0 justify-center">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={enChargement}
            onClick={() => void chargerPlus()}
          >
            {chargementEchoue ? TEXTES.boutonReessayer : TEXTES.chargerPlus}
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
