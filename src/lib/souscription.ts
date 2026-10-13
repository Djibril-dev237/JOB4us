import type { MessageAffiche } from '@/lib/messagerie-client-types'

// ─── Couture de transport de la messagerie (M8, Vague 2) ─────────────────────
//
// Le transport ne transporte JAMAIS le contenu des messages, seulement le
// fait « il y a du nouveau » : le client re-tire la dernière page par son
// propre GET authentifié (route /api/messagerie/actualiser). Aucune donnée
// ne circule en clair dans un canal tierce (Pusher/Ably) — le contenu reste
// derrière la session cookie.
//
// Interface FIGÉE entre la couche d'abonnement et les composants : la
// migration future (endpoint à jeton, WebSocket) remplace
// l'implémentation de `creerSouscriptionPolling` SANS que l'interface ne
// bouge — d'où la séparation entre `Souscription` (contrat) et la fabrique
// (polling, aujourd'hui).
//
// Module isomorphe pur : aucun import server-only, aucune référence à
// `document`/`window` en haut niveau (uniquement dans le corps des
// callbacks, jamais à l'évaluation du module) — importable depuis un
// composant client comme depuis un test Node.
// ---------------------------------------------------------------------------

/**
 * Couture LOCALE composer → fil : le message confirmé par le serveur est
 * publié sur cet événement `window` le temps de la confirmation (les
 * interfaces figées des composants interdisent un état partagé). Le fil le
 * fusionne par id — idempotent : la trame de polling suivante re-dédoublonne
 * le même message, la bulle optimiste ne disparaît donc jamais.
 */
export const EVENEMENT_MESSAGE_ENVOYE = 'job4us:messagerie:message-envoye'

/** Shape JSON de la route GET /api/messagerie/actualiser (200). */
export interface ReponseActualisation {
  ok: true
  /** Dernières ≤ 30 pages de messages, ordre croissant, dates en ISO. */
  messages: MessageAffiche[]
  aPlusAncien: boolean
  lectureSeule: boolean
  bloqueeParMoi: boolean
  bloqueeParAutre: boolean
}

/** Abonnement « il y a du nouveau » — démarré/arrêté par le composant. */
export interface Souscription {
  demarrer(): void
  arreter(): void
}

/**
 * Garde de forme sur la réponse JSON : le serveur est le nôtre, mais un
 * proxy ou une réponse tronquée ne doit pas faire planter le fil — toute
 * réponse non conforme est traitée comme une erreur réseau (surErreur),
 * jamais comme du contenu.
 */
function estReponseActualisation(donnees: unknown): donnees is ReponseActualisation {
  if (typeof donnees !== 'object' || donnees === null) {
    return false
  }
  const champs = donnees as Record<string, unknown>
  return (
    champs.ok === true &&
    Array.isArray(champs.messages) &&
    typeof champs.aPlusAncien === 'boolean' &&
    typeof champs.lectureSeule === 'boolean' &&
    typeof champs.bloqueeParMoi === 'boolean' &&
    typeof champs.bloqueeParAutre === 'boolean'
  )
}

/**
 * Fabrique une souscription par polling (5 s conversation ouverte).
 *
 * Garde-fous embarqués (la politique d'inactivité et de visibilité
 * d'USAGE vit dans le composant, qui alimente `actif()`) :
 *  - onglet caché (`document.visibilityState !== 'visible'`) → pas
 *    d'appel, la trame est simplement sautée ;
 *  - `actif()` faux → pas d'appel (pause inactivité) ;
 *  - 1 requête en vol MAXIMUM : le drapeau `enVol` empile les trames
 *    lentes au lieu de les envoyer en parallèle ;
 *  - erreur (réseau, HTTP non-200, JSON non conforme) → `surErreur()`
 *    SANS rejouer immédiatement : la prochaine trame normale (5 s plus
 *    tard) reprend la main ;
 *  - `credentials` non spécifié = same-origin par défaut : le cookie de
 *    session part, jamais vers un autre hôte.
 */
export function creerSouscriptionPolling(options: {
  /** ex. `/api/messagerie/actualiser?conversationId=${id}` */
  url: string
  /** 5000 pour une conversation ouverte. */
  intervalleMs: number
  /** false → pause (inactivité 5 min) ; la visibilité est testée en amont. */
  actif: () => boolean
  surReponse: (donnees: ReponseActualisation) => void
  surErreur: () => void
}): Souscription {
  let minuterie: ReturnType<typeof setInterval> | null = null
  let enVol = false

  async function tic(): Promise<void> {
    // Onglet caché ou requête précédente encore en vol : on saute la trame.
    if (enVol) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (!options.actif()) return

    enVol = true
    try {
      const reponse = await fetch(options.url, { cache: 'no-store' })
      if (!reponse.ok) {
        options.surErreur()
        return
      }
      const donnees: unknown = await reponse.json()
      if (!estReponseActualisation(donnees)) {
        options.surErreur()
        return
      }
      options.surReponse(donnees)
    } catch {
      // Réseau coupé / JSON illisible : on n'alerte pas, la trame suivante
      // reprend de façon silencieuse (pas de rejouage immédiat).
      options.surErreur()
    } finally {
      enVol = false
    }
  }

  return {
    demarrer(): void {
      if (minuterie !== null) return
      minuterie = setInterval(() => {
        void tic()
      }, options.intervalleMs)
    },
    arreter(): void {
      if (minuterie === null) return
      clearInterval(minuterie)
      minuterie = null
    },
  }
}
