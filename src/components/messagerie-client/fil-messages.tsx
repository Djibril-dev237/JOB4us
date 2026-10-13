'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  chargerMessagesAnciens,
  marquerConversationLue,
} from '@/app/actions/messagerie'
import { Button } from '@/components/ui/button'
import type { MessageAffiche } from '@/lib/messagerie-client-types'
import { TEXTES } from '@/lib/messagerie-labels'
import { creerSouscriptionPolling, EVENEMENT_MESSAGE_ENVOYE, type ReponseActualisation } from '@/lib/souscription'

import { ModaleSignalement } from './modale-signalement'

// ─── Fil de messages d'une conversation (M8, Vague 2) ────────────────────────
//
// Composant CLIENT, interface FIGÉE avec SA-5. Le fil EST le seul
// propriétaire de l'état des messages côté navigateur :
//
//  * pagination ancienne par curseur (`chargerMessagesAnciens`) avec
//    conservation du scroll (chat attendu : on charge au-dessus, le bas
//    ne bouge pas) ;
//  * souscription 5 s via la couture `creerSouscriptionPolling` : le
//    transport ne transporte que « il y a du nouveau », le contenu des
//    messages repasse par la même route GET authentifiée ; fusion par
//    `id` (jamais par position : deux pages peuvent se chevaucher) ;
//  * bascule lecture seule / blocage détectée par le polling → UN SEUL
//    `window.location.reload()` (le bandeau vient du serveur ; recharger
//    en boucle figerait l'écran, d'où le drapeau `rechargee`) ;
//  * pause : onglet caché (dans le transport) + inactivité 5 min (ici,
//    via `actif()`) ; le retour d'activité reprend à la trame suivante.
//
// ZÉRO `dangerouslySetInnerHTML` : le contenu est rendu en texte brut,
// React échappe toute interpolation — le nettoyage balises est serveur
// (messagerie-contenu), la couche d'affichage n'a rien à nettoyer.
//
// `min-w-0` partout : le fil vit dans une colonne à côté d'un rail, le
// moindre `min-w-auto` (défaut d'un flex enfant) ferait défiler la page
// en horizontal sous 360 px.
// ---------------------------------------------------------------------------

/** Trame de polling d'une conversation ouverte. */
const INTERVALLE_POLLING_MS = 5_000

/** Inactivité utilisateur : pause du polling (reprise à la trame suivante). */
const INACTIVITE_MS = 5 * 60_000

/** Tolérance « bas du fil visible » (px) — spec chat : 80 px. */
const SEUIL_BAS_VISIBLE = 80

/** Fréquence max d'écriture du tampon d'inactivité (mousemove rafraîchi à 60 Hz). */
const THROTTLE_INACTIVITE_MS = 1_000

/** Horodatage des bulles : heure courte, fuseau du projet (motif M6). */
const FORMATEUR_HEURE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  hour: '2-digit',
  minute: '2-digit',
})

export interface FilMessagesProps {
  conversationId: number
  monUserId: number
  messagesInitiaux: MessageAffiche[]
  plusAncienInitial: boolean
  /**
   * Verdict serveur AU MONTAGE (statut terminal ou blocage, tel que calculé
   * par la page) : baseline du détecteur de bascule. Sans elle, la première
   * réponse poll servirait de référence et toute fermeture survenue avant la
   * première trame serait détectée une trame trop tard ; avec elle, la
   * page relue recalcule la même vérité → aucune boucle de rechargement.
   */
  lectureSeuleInitial: boolean
}

/** Union de deux pages ASC par `id`, tri ASC stable (createdAt, puis id). */
function fusionnerParId(...pages: MessageAffiche[][]): MessageAffiche[] {
  const parId = new Map<number, MessageAffiche>()
  for (const page of pages) {
    for (const message of page) {
      parId.set(message.id, message)
    }
  }
  return [...parId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  )
}

export function FilMessages({
  conversationId,
  monUserId,
  messagesInitiaux,
  plusAncienInitial,
  lectureSeuleInitial,
}: FilMessagesProps) {
  const [messages, setMessages] = useState<MessageAffiche[]>(() =>
    fusionnerParId(messagesInitiaux),
  )
  const [plusAncien, setPlusAncien] = useState(plusAncienInitial)
  const [enChargement, setEnChargement] = useState(false)
  const [nouveaux, setNouveaux] = useState(0)
  const [messageASignaler, setMessageASignaler] = useState<MessageAffiche | null>(null)

  const conteneurRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  // Dernière interaction : alimente `actif()` de la souscription. `null` =
  // jamais d'interagi depuis le montage : ni initialisation impure en render
  // (`Date.now()` y est interdit par react-hooks/purity), ni faux état
  // « inactif » au premier chargement — le premier poll part tout de suite.
  const dernierContactRef = useRef<number | null>(null)
  // Dernier verdict serveur vu (détecter une bascule → recharger 1 fois) :
  // baseline = la PROP du montage (la RSC connaît déjà les trois drapeaux).
  const etatServeurRef = useRef<{ lectureSeule: boolean }>({
    lectureSeule: lectureSeuleInitial,
  })
  const rechargeeRef = useRef(false)
  // Demande de scroll : « coller au bas » ou « conserver le bas » après
  // un préfixe (useLayoutEffect lit ces deux drapeaux).
  const defilerBasRef = useRef(false)
  const hauteurAvantPrefixeRef = useRef<number | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const basVisible = useCallback((): boolean => {
    const element = conteneurRef.current
    if (element === null) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= SEUIL_BAS_VISIBLE
  }, [])

  // ── Réaction à une actualisation du serveur ────────────────────────────────
  const traiterActualisation = useCallback(
    (donnees: ReponseActualisation) => {
      // Bascule statut/blocage : le serveur a changé de verdict — le
      // bandeau est une affaire de RSC, on recharge UNE fois. La baseline
      // vient de la prop (connue au montage) : détection dès la PREMIÈRE
      // trame, et la page relue recalcule la même vérité serveur → pas de
      // boucle. `lectureSeule` agrège statut terminal ET blocage (les deux
      // sens) : comparer ce seul drapeau couvre toute bascule de verdict.
      const precedent = etatServeurRef.current
      const aBascule = precedent.lectureSeule !== donnees.lectureSeule
      etatServeurRef.current = { lectureSeule: donnees.lectureSeule }
      if (aBascule && !rechargeeRef.current) {
        rechargeeRef.current = true
        window.location.reload()
        return
      }

      // La réponse ne contient que la DERNIÈRE page : `aPlusAncien` décrit
      // CETTE page, pas l'historique déjà chargé — le laisser écraser l'état
      // ferait réapparaître le bouton « Charger plus » à chaque trame (dès
      // que la conversation dépasse PAGE messages, la dernière page a
      // toujours une page avant elle). Ce drapeau ne bouge que via
      // `chargerPlus` (transition monotone true → false).

      const connus = new Set(messagesRef.current.map((message) => message.id))
      const arrivants = donnees.messages.filter((message) => !connus.has(message.id))
      if (arrivants.length === 0) return

      const auBas = basVisible()
      setMessages((precedents) => fusionnerParId(precedents, arrivants))
      if (auBas) {
        // Le bas est visible : on pousse auto et on accuse réception
        // (fire-and-forget : une lecture qui échoue ne doit pas casser le fil).
        defilerBasRef.current = true
        setNouveaux(0)
        void marquerConversationLue(conversationId)
      } else {
        // Le bas n'est pas visible : on compte, on NE défile PAS (le lecteur
        // remonte probablement dans l'historique).
        setNouveaux((compteur) => compteur + arrivants.length)
      }
    },
    [basVisible, conversationId],
  )

  // ── Souscription 5 s (couture transport, Étape 3) ─────────────────────────
  useEffect(() => {
    const souscription = creerSouscriptionPolling({
      url: `/api/messagerie/actualiser?conversationId=${conversationId}`,
      intervalleMs: INTERVALLE_POLLING_MS,
      // Inactivité 5 min : la logique vit ICI (le transport ne connaît que
      // ce booléen). La visibilité onglet est testée par le transport.
      // `null` (aucune interaction depuis le montage) = encore actif.
      actif: () =>
        dernierContactRef.current === null ||
        Date.now() - dernierContactRef.current < INACTIVITE_MS,
      surReponse: (donnees) => traiterActualisation(donnees),
      // Échec silencieux : la trame suivante reprend (pas de rejeu immédiat).
      surErreur: () => {},
    })
    souscription.demarrer()
    return () => souscription.arreter()
  }, [conversationId, traiterActualisation])

  // ── Remplacement de l'optimiste : le composer publie le message confirmé ──
  // Couture locale (CustomEvent, cf. `souscription.ts`) : les interfaces
  // figées interdisent un état partagé entre composants. La fusion par id
  // rend l'opération idempotente — la trame de polling suivante retrouve le
  // même message et le dé-dédoublonne sans trou ni saut de scroll.
  useEffect(() => {
    function surEnvoi(event: Event): void {
      const message = (event as CustomEvent<MessageAffiche>).detail
      setMessages((precedents) => fusionnerParId(precedents, [message]))
    }
    window.addEventListener(EVENEMENT_MESSAGE_ENVOYE, surEnvoi)
    return () => window.removeEventListener(EVENEMENT_MESSAGE_ENVOYE, surEnvoi)
  }, [])

  // ── Inactivité : mousemove/keydown/scroll (throttlés) + visibilitychange ──
  useEffect(() => {
    let derniereEcriture = 0
    function marquerContact(): void {
      const maintenant = Date.now()
      if (maintenant - derniereEcriture < THROTTLE_INACTIVITE_MS) return
      derniereEcriture = maintenant
      dernierContactRef.current = maintenant
    }
    // Un onglet qui revient au premier plan n'est pas « inactif » : on
    // repousse l'échéance pour éviter un re-polling immédiat refusé.
    function surVisibilite(): void {
      if (document.visibilityState === 'visible') dernierContactRef.current = Date.now()
    }
    window.addEventListener('mousemove', marquerContact, { passive: true })
    window.addEventListener('keydown', marquerContact)
    window.addEventListener('scroll', marquerContact, { passive: true })
    document.addEventListener('visibilitychange', surVisibilite)
    return () => {
      window.removeEventListener('mousemove', marquerContact)
      window.removeEventListener('keydown', marquerContact)
      window.removeEventListener('scroll', marquerContact)
      document.removeEventListener('visibilitychange', surVisibilite)
    }
  }, [])

  // ── Position de scroll post-rendu ─────────────────────────────────────────
  // Deux demandes possibles, mutuellement exclusives :
  //  * « coller au bas » (nouveau message reçu alors qu'on y était) ;
  //  * « conserver le bas » (chargement ancien : le contenu pousse vers
  //    le haut, on compense pour que le message sous le curseur ne bouge pas).
  useLayoutEffect(() => {
    const element = conteneurRef.current
    if (element === null) return
    if (defilerBasRef.current) {
      defilerBasRef.current = false
      element.scrollTop = element.scrollHeight
      return
    }
    const hauteurAvant = hauteurAvantPrefixeRef.current
    if (hauteurAvant !== null) {
      hauteurAvantPrefixeRef.current = null
      element.scrollTop += element.scrollHeight - hauteurAvant
    }
  }, [messages])

  // Ouverture : le fil démarre en bas (chat attendu).
  useEffect(() => {
    const element = conteneurRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [])

  // ── Pagination ancienne ────────────────────────────────────────────────────
  const chargerPlus = useCallback(async () => {
    const plusAncienMessage = messagesRef.current[0]
    if (enChargement || plusAncienMessage === undefined) return
    setEnChargement(true)
    try {
      const page = await chargerMessagesAnciens(conversationId, plusAncienMessage.createdAt)
      // null = 404 (conversation disparue / accès retiré) : plus rien à
      // charger au-dessus, on masque le bouton.
      if (page === null) {
        setPlusAncien(false)
        return
      }
      const element = conteneurRef.current
      hauteurAvantPrefixeRef.current = element === null ? null : element.scrollHeight
      setMessages((precedents) => fusionnerParId(page.messages, precedents))
      setPlusAncien(page.aPlusAncien)
    } catch {
      // Échec réseau / action indisponible : l'état n'a pas bougé, le
      // bouton reste actif — jamais d'exception qui propage depuis un
      // gestionnaire de clic.
    } finally {
      setEnChargement(false)
    }
  }, [conversationId, enChargement])

  const defilerAuBas = useCallback(() => {
    defilerBasRef.current = true
    setNouveaux(0)
    setMessages((precedents) => [...precedents])
  }, [])

  return (
    <div className="flex min-w-0 flex-col">
      {/* Pagination ancienne : AU-DESSUS du fil, on charge vers le passé. */}
      {plusAncien ? (
        <div className="flex min-w-0 justify-center pb-2">
          <Button variant="secondary" size="sm" onClick={() => void chargerPlus()} disabled={enChargement}>
            {enChargement ? TEXTES.chargement : TEXTES.chargerPlus}
          </Button>
        </div>
      ) : null}

      <div
        ref={conteneurRef}
        className="min-w-0 max-h-[60vh] overflow-y-auto rounded-md border border-line bg-surface px-3 py-3"
      >
        {messages.length === 0 ? (
          <p className="min-w-0 py-6 text-center text-sm text-ink-muted">
            {TEXTES.conversationVide}
          </p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {messages.map((message) => {
              const mien = message.emetteurId === monUserId
              return (
                <li
                  key={message.id}
                  className={`flex min-w-0 ${mien ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    // Variante « mien » : alignée à droite (fin du fil),
                    // marqueur couleur brand ; l'autre : début de ligne.
                    className={[
                      'min-w-0 max-w-[85%] rounded-md border px-3 py-2',
                      mien
                        ? 'border-brand-tint bg-brand-tint'
                        : 'border-line bg-surface-alt',
                    ].join(' ')}
                  >
                    {/* Texte brut, JAMAIS d'HTML interpolé. */}
                    <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
                      {message.contenu}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center justify-end gap-2">
                      <time
                        dateTime={message.createdAt}
                        className="text-xs text-ink-muted"
                      >
                        {FORMATEUR_HEURE.format(new Date(message.createdAt))}
                      </time>
                      <button
                        type="button"
                        onClick={() => setMessageASignaler(message)}
                        className="rounded-sm px-1 text-xs text-ink-muted underline-offset-2 transition-colors duration-fast hover:text-danger hover:underline"
                      >
                        {TEXTES.signaler}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Zone « il y a du nouveau » : aria-live polite, le compteur est
          annoncé sans voler le focus. */}
      <div aria-live="polite" className="flex min-h-10 min-w-0 items-center justify-center pt-2">
        {nouveaux > 0 ? (
          <Button variant="primary" size="sm" onClick={defilerAuBas}>
            {TEXTES.nouveauxMessages}
          </Button>
        ) : null}
      </div>

      {messageASignaler !== null ? (
        <ModaleSignalement
          message={messageASignaler}
          onFermer={() => setMessageASignaler(null)}
        />
      ) : null}
    </div>
  )
}
