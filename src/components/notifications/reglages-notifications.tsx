'use client'

import { useState } from 'react'

import {
  basculerPreferenceEmail,
  enregistrerResumeQuotidien,
} from '@/app/actions/notifications'
import {
  METADONNEES,
  TEXTES,
  TYPE_NOTIFICATIONS,
  TYPES_NON_DESACTIVABLES,
  type TypeNotification,
} from '@/lib/notifications-labels'

// ─── Réglages de notification : emails par type + résumé quotidien ───────────
//
// Composant CLIENT (interrupteurs), rendu par la page serveur qui lui transmet
// l'état EFFECTIF : ligne `NotificationPreference` absente = défaut du
// catalogue (`preferencesParDefaut()`), ligne présente = valeur stockée. La
// page est la seule à lire la base, ici on ne fait que BASCULER.
//
// Interrupteur : checkbox native stylée `accent-brand` — le motif du dépôt
// (profil-form.tsx, offre-form.tsx), jamais une librairie absente de
// package.json. `onChange` soumet le booléen VRAI du DOM (`z.boolean()` strict
// côté schema, jamais un FormData « on »), clavier et lecteur d'écran compris
// (case à cocher native, `aria-label` nommant l'objet + l'intention
// `TEXTES.interrupteurEmail`, description en `aria-describedby`).
//
// ARBITRAGE — `signalementRecu` est EXCLUE de la liste : c'est l'entrée de
// `TYPES_NON_DESACTIVABLES` (seule, `METADONNEES.desactivable = false`),
// EMAIL DE SÉCURITÉ au devoir de modération qui ne se désactive jamais. Aucun
// interrupteur = aucune promesse d'écriture ; `basculerPreferenceEmail`
// refuse d'ailleurs toute ligne pour ce type (contrôle métier côté action).
//
// Bascule OPTIMISTE + retour net : l'état local bouge d'abord, le verdict
// serveur le confirme ou le RÉTABLIT — jamais de bandeau « enregistré » sur
// une écriture ratée, jamais d'exception qui propage depuis un `onChange`.
// Tous les textes sortent de `TEXTES` et `METADONNEES` (source unique).
// ---------------------------------------------------------------------------

/** Bandeau de succès (tokens M2, motif ALERTE_SUCCES des pages du dépôt). */
const CLASSE_SUCCES = 'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

/** Bandeau de refus (tokens M2, motif ALERTE_ERREUR des pages du dépôt). */
const CLASSE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

/** Interrupteur natif : gabarit `accent-brand` du dépôt, taille de ligne. */
const CLASSE_INTERRUPTEUR = 'mt-1 size-5 shrink-0 accent-brand'

type Retour = { variante: 'succes' | 'erreur'; texte: string }

interface Props {
  /** État EFFECTIF par type, calculé côté serveur (défaut + lignes en base). */
  etatsEmails: Record<TypeNotification, boolean>
  /** `NotificationReglage.resumeQuotidien` (ligne absente = false). */
  resumeQuotidien: boolean
}

/** Types réglables : catalogue MOINS les entrées non désactivables. */
const TYPES_REGLABLES = TYPE_NOTIFICATIONS.filter(
  (type) => !TYPES_NON_DESACTIVABLES.includes(type),
)

export function ReglagesNotifications({ etatsEmails, resumeQuotidien }: Props) {
  const [etats, setEtats] = useState<Record<TypeNotification, boolean>>(etatsEmails)
  const [resume, setResume] = useState(resumeQuotidien)
  const [retour, setRetour] = useState<Retour | null>(null)
  /** Clé du réglage en vol : un type, ou `'resume'` — double clic interdit. */
  const [enCours, setEnCours] = useState<string | null>(null)

  async function basculerEmail(type: TypeNotification, actif: boolean): Promise<void> {
    if (enCours !== null || etats[type] === actif) return
    const precedent = etats[type]

    setEnCours(type)
    setRetour(null)
    setEtats((etat) => ({ ...etat, [type]: actif }))
    try {
      const resultat = await basculerPreferenceEmail({ type, emailActive: actif })
      if (!resultat.ok) {
        setEtats((etat) => ({ ...etat, [type]: precedent }))
        setRetour({ variante: 'erreur', texte: TEXTES.preferencesEchouees })
        return
      }
      setRetour({ variante: 'succes', texte: TEXTES.preferencesEnregistrees })
    } catch {
      // Réseau coupé / action indisponible : la valeur affichée n'a JAMAIS
      // été écrite, on restitue l'état serveur plutôt que mentir.
      setEtats((etat) => ({ ...etat, [type]: precedent }))
      setRetour({ variante: 'erreur', texte: TEXTES.preferencesEchouees })
    } finally {
      setEnCours(null)
    }
  }

  async function basculerResume(actif: boolean): Promise<void> {
    if (enCours !== null || resume === actif) return
    const precedent = resume

    setEnCours('resume')
    setRetour(null)
    setResume(actif)
    try {
      const resultat = await enregistrerResumeQuotidien({ resumeQuotidien: actif })
      if (!resultat.ok) {
        setResume(precedent)
        setRetour({ variante: 'erreur', texte: TEXTES.preferencesEchouees })
        return
      }
      setRetour({ variante: 'succes', texte: TEXTES.preferencesEnregistrees })
    } catch {
      setResume(precedent)
      setRetour({ variante: 'erreur', texte: TEXTES.preferencesEchouees })
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Retours d'action : verbatim TEXTES, annoncés sans déplacer le focus. */}
      {retour !== null ? (
        <p
          role={retour.variante === 'erreur' ? 'alert' : 'status'}
          className={retour.variante === 'erreur' ? CLASSE_ERREUR : CLASSE_SUCCES}
        >
          {retour.texte}
        </p>
      ) : null}

      <section aria-labelledby="titre-section-emails" className="min-w-0">
        <h2 id="titre-section-emails" className="text-base font-semibold text-ink">
          {TEXTES.sectionEmails}
        </h2>

        <ul className="mt-2 min-w-0 divide-y divide-line rounded-md border border-line bg-surface shadow-card">
          {TYPES_REGLABLES.map((type) => {
            const id = `preference-email-${type}`
            const descriptionId = `${id}-description`
            return (
              <li key={type} className="flex min-w-0 items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="text-sm font-medium text-ink">
                    {METADONNEES[type].libelle}
                  </label>
                  <p id={descriptionId} className="mt-0.5 text-xs text-ink-muted">
                    {METADONNEES[type].description}
                  </p>
                </div>

                <input
                  id={id}
                  type="checkbox"
                  checked={etats[type]}
                  disabled={enCours === type}
                  onChange={(event) => void basculerEmail(type, event.target.checked)}
                  aria-label={`${METADONNEES[type].libelle} : ${TEXTES.interrupteurEmail}`}
                  aria-describedby={descriptionId}
                  className={CLASSE_INTERRUPTEUR}
                />
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="titre-section-resume" className="min-w-0">
        <h2 id="titre-section-resume" className="text-base font-semibold text-ink">
          {TEXTES.sectionResumeQuotidien}
        </h2>

        <div className="mt-2 flex min-w-0 items-start justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-card">
          <div className="min-w-0 flex-1">
            <label htmlFor="reglage-resume-quotidien" className="text-sm font-medium text-ink">
              {TEXTES.resumeQuotidien}
            </label>
            <p
              id="reglage-resume-quotidien-description"
              className="mt-0.5 text-xs text-ink-muted"
            >
              {TEXTES.descriptionResumeQuotidien}
            </p>
          </div>

          <input
            id="reglage-resume-quotidien"
            type="checkbox"
            checked={resume}
            disabled={enCours === 'resume'}
            onChange={(event) => void basculerResume(event.target.checked)}
            aria-label={`${TEXTES.resumeQuotidien} : ${TEXTES.interrupteurEmail}`}
            aria-describedby="reglage-resume-quotidien-description"
            className={CLASSE_INTERRUPTEUR}
          />
        </div>
      </section>
    </div>
  )
}
