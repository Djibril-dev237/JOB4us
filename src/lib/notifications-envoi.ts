import 'server-only'

import type { EmailConstruit } from '@/lib/notifications-emails'

// ─── Envoi des emails via Resend (M9, Vague 3) ──────────────────────────────
//
// PÉRIMÈTRE MINIMAL, SANS SDK : le dépôt n'embarque pas le paquet `resend` ;
// l'API HTTP officielle (POST https://api.resend.com/emails) suffit et évite
// une dépendance supplémentaire. Le client est ici, isolé, remplaçable, et
// TOUTE la logique de file vit dans notifications-outbox.ts.
//
// CONFIGURATION (variables documentées dans .env.example) :
//  * `RESEND_API_KEY` : clé d'API (serveur uniquement, jamais exposée) ;
//  * `EMAIL_FROM` : expéditeur vérifié chez Resend (`Nom <adresse>` ou
//    adresse seule) — AUCUNE valeur par défaut inventée : sans elle, aucun
//    envoi n'est tenté.
//  * absence de l'une des deux → `estEnvoiConfigure()` faux : l'outbox
//    s'arrête AVANT toute requête et ne touche AUCUNE ligne (les emails
//    restent en attente, ils partiront quand la configuration sera fournie).
//
// CONTRAT DE DÉFAILLANCE (critère « échec email jamais bloquant ») :
//  * `envoyerEmail` NE LÈVE JAMAIS et ne lit JAMAIS le corps d'erreur de
//    Resend : une réponse d'erreur peut recopier l'adresse du destinataire,
//    donc de la donnée personnelle. On ne conserve qu'un CODE COURT
//    (`http_422`, `reseau`, `delai`, `configuration`), compatible avec la
//    colonne `EmailNotification.erreur` (VarChar 300) et exploitable en
//    supervision sans fuite ;
//  * aucun `console.*` ici : le nom et l'adresse du destinataire ne doivent
//    apparaître dans aucun journal. L'appelant décide (et ne trace que des
//    compteurs).
// ---------------------------------------------------------------------------

/** Endpoint transactionnel Resend (un seul email par appel). */
const URL_RESEND = 'https://api.resend.com/emails'

/** Délai maximal d'un appel : un cron ne doit pas rester suspendu. */
const DELAI_MAX_MS = 10_000

/** Résultat d'un envoi : jamais une exception, jamais de PII. */
export type ResultatEnvoi = { ok: true } | { ok: false; erreur: string }

/** Vrai si les DEUX variables nécessaires à un envoi sont fournies. */
export function estEnvoiConfigure(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim())
}

/**
 * Envoie UN email transactionnel. Rend `{ ok: false, erreur }` sur toute
 * défaillance (configuration, réseau, délai, statut HTTP non 2xx) — contrat
 * no-throw, l'outbox décide de la reprise ou de l'abandon.
 */
export async function envoyerEmail(params: {
  destinataire: string
  email: EmailConstruit
}): Promise<ResultatEnvoi> {
  const cle = process.env.RESEND_API_KEY?.trim()
  const expediteur = process.env.EMAIL_FROM?.trim()
  if (!cle || !expediteur) return { ok: false, erreur: 'configuration' }

  try {
    const reponse = await fetch(URL_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cle}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: expediteur,
        to: [params.destinataire],
        subject: params.email.sujet,
        text: params.email.texte,
        html: params.email.html,
      }),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    })

    // Le corps n'est volontairement PAS lu : erreur Resend = donnée libre.
    if (!reponse.ok) return { ok: false, erreur: `http_${reponse.status}` }
    return { ok: true }
  } catch (erreur) {
    // `AbortSignal.timeout` rejette avec un DOMException nommé TimeoutError.
    const nom = erreur instanceof Error ? erreur.name : ''
    return { ok: false, erreur: nom === 'TimeoutError' ? 'delai' : 'reseau' }
  }
}
