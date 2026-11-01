'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  deciderSignalement,
  ouvrirConversationSignalement,
  retablirMessage,
} from '@/app/actions/admin-messagerie'
import { Button, buttonClassName } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TEXTES_MODERATION } from '@/lib/admin-moderation-texts'
import {
  DECISIONS_SIGNALEMENT,
  DESCRIPTIONS_DECISION,
  LIBELLES_DECISION,
  MOTIFS_ACCES_CONVERSATION,
  MOTIFS_DECISION_SIGNALEMENT,
  MOTIFS_RETABLISSEMENT,
  OPTIONS_MOTIF_ACCES_CONVERSATION,
  OPTIONS_MOTIF_DECISION_SIGNALEMENT,
  OPTIONS_MOTIF_RETABLISSEMENT,
  type DecisionSignalement,
} from '@/lib/moderation-labels'

import { BandeauAdmin } from '@/components/admin/bandeau-admin'

// ─── Formulaires du détail d'un signalement (M10) ────────────────────────────
//
// Trois procédures distinctes, toutes gardées côté serveur :
//  1. accès : motif fermé + réauthentification -> grant de 5 minutes ;
//  2. décision : réauthentification + grant -> décision transactionnelle ;
//  3. rétablissement : réauthentification -> ligne append-only.
//
// Les composants ne font aucune vérification d'autorisation : ils affichent
// seulement l'état renvoyé par l'action. Un refus serveur ne détruit jamais
// la saisie en cours (même doctrine que les formulaires M8).
// ---------------------------------------------------------------------------

type Retour =
  | { type: 'succes' | 'deja' | 'erreur' | 'interdit' | 'reauth'; message: string }
  | null

function lienReauth(cheminRetour: string): string {
  return `/admin/reauth?retour=${encodeURIComponent(cheminRetour)}`
}

function MessageRetour({ retour, cheminRetour }: { retour: Retour; cheminRetour: string }) {
  if (retour === null) return null
  if (retour.type === 'reauth') {
    return (
      <div className="min-w-0 space-y-2">
        <BandeauAdmin variante="erreur" message={retour.message} />
        <Link href={lienReauth(cheminRetour)} className={buttonClassName('secondary', 'sm')}>
          {TEXTES_MODERATION.reauthLien}
        </Link>
      </div>
    )
  }
  return (
    <BandeauAdmin
      variante={retour.type === 'succes' || retour.type === 'deja' ? 'succes' : 'erreur'}
      message={retour.message}
    />
  )
}

export function AccesSignalementForm({
  signalementId,
  reauth,
  cheminRetour,
}: {
  signalementId: number
  reauth: boolean
  cheminRetour: string
}) {
  const router = useRouter()
  const [motif, setMotif] = useState<string>(MOTIFS_ACCES_CONVERSATION[0])
  const [enCours, setEnCours] = useState(false)
  const [retour, setRetour] = useState<Retour>(null)

  async function ouvrir(): Promise<void> {
    if (enCours) return
    setEnCours(true)
    setRetour(null)
    try {
      const resultat = await ouvrirConversationSignalement({ signalementId, motif })
      if (resultat.ok) {
        router.refresh()
        return
      }
      if (resultat.erreur === 'reauth') {
        setRetour({ type: 'reauth', message: TEXTES_MODERATION.reauthRequise })
      } else if (resultat.erreur === 'interdit') {
        setRetour({ type: 'interdit', message: TEXTES_MODERATION.accesInterdit })
      } else {
        setRetour({ type: 'erreur', message: TEXTES_MODERATION.accesEchoue })
      }
    } catch {
      setRetour({ type: 'erreur', message: TEXTES_MODERATION.accesEchoue })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <section className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-card">
      <h2 className="text-base font-bold text-ink">{TEXTES_MODERATION.accesTitre}</h2>
      <p className="mt-1 text-sm text-ink-muted">{TEXTES_MODERATION.accesExplication}</p>

      <div className="mt-4">
        <MessageRetour retour={retour} cheminRetour={cheminRetour} />
      </div>

      {reauth ? (
        <div className="mt-4 max-w-sm space-y-3">
          <Select
            label={TEXTES_MODERATION.accesMotif}
            value={motif}
            options={OPTIONS_MOTIF_ACCES_CONVERSATION.map((option) => ({
              value: option.valeur,
              label: option.libelle,
            }))}
            onChange={(event) => setMotif(event.target.value)}
          />
          <Button variant="primary" onClick={() => void ouvrir()} disabled={enCours}>
            {TEXTES_MODERATION.accesOuvrir}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink-muted">{TEXTES_MODERATION.reauthRequise}</p>
          <Link href={lienReauth(cheminRetour)} className={buttonClassName('secondary', 'sm')}>
            {TEXTES_MODERATION.reauthLien}
          </Link>
        </div>
      )}
    </section>
  )
}

export function DecisionSignalementForm({
  signalementId,
  statut,
  cheminRetour,
}: {
  signalementId: number
  statut: 'ouvert' | 'traite'
  cheminRetour: string
}) {
  const router = useRouter()
  const [decision, setDecision] = useState<DecisionSignalement>(DECISIONS_SIGNALEMENT[0])
  const [motif, setMotif] = useState<string>(MOTIFS_DECISION_SIGNALEMENT[0])
  const [note, setNote] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [retour, setRetour] = useState<Retour>(null)

  if (statut === 'traite') return null

  async function enregistrer(): Promise<void> {
    if (enCours) return
    setEnCours(true)
    setRetour(null)
    try {
      const resultat = await deciderSignalement({
        signalementId,
        decision,
        motif,
        noteInterne: note.trim() === '' ? undefined : note,
      })
      if (resultat.ok) {
        setRetour({
          type: resultat.deja ? 'deja' : 'succes',
          message: resultat.deja
            ? TEXTES_MODERATION.decisionDeja
            : TEXTES_MODERATION.decisionFaite,
        })
        router.refresh()
        return
      }
      if (resultat.erreur === 'reauth') {
        setRetour({ type: 'reauth', message: TEXTES_MODERATION.reauthRequise })
      } else if (resultat.erreur === 'interdit') {
        setRetour({ type: 'interdit', message: TEXTES_MODERATION.decisionInterdite })
      } else {
        setRetour({ type: 'erreur', message: TEXTES_MODERATION.decisionEchouee })
      }
    } catch {
      setRetour({ type: 'erreur', message: TEXTES_MODERATION.decisionEchouee })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <section className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-card">
      <h2 className="text-base font-bold text-ink">{TEXTES_MODERATION.decisionTitre}</h2>
      <p className="mt-1 text-sm text-ink-muted">{TEXTES_MODERATION.decisionAide}</p>

      <div className="mt-4">
        <MessageRetour retour={retour} cheminRetour={cheminRetour} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Select
          label={TEXTES_MODERATION.decisionChamp}
          value={decision}
          options={DECISIONS_SIGNALEMENT.map((valeur) => ({
            value: valeur,
            label: LIBELLES_DECISION[valeur],
          }))}
          onChange={(event) => setDecision(event.target.value as DecisionSignalement)}
        />
        <Select
          label={TEXTES_MODERATION.motifChamp}
          value={motif}
          options={OPTIONS_MOTIF_DECISION_SIGNALEMENT.map((option) => ({
            value: option.valeur,
            label: option.libelle,
          }))}
          onChange={(event) => setMotif(event.target.value)}
        />
      </div>

      <p className="mt-2 text-xs text-ink-muted">{DESCRIPTIONS_DECISION[decision]}</p>

      <div className="mt-3">
        <Textarea
          label={TEXTES_MODERATION.noteChamp}
          value={note}
          rows={3}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="mt-3">
        <Button variant="primary" onClick={() => void enregistrer()} disabled={enCours}>
          {TEXTES_MODERATION.decisionValider}
        </Button>
      </div>
    </section>
  )
}

export function RetablirMessageForm({
  messageId,
  masque,
  cheminRetour,
}: {
  messageId: number
  masque: boolean
  cheminRetour: string
}) {
  const router = useRouter()
  const [motif, setMotif] = useState<string>(MOTIFS_RETABLISSEMENT[0])
  const [note, setNote] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [retour, setRetour] = useState<Retour>(null)

  if (!masque) return null

  async function retablir(): Promise<void> {
    if (enCours) return
    setEnCours(true)
    setRetour(null)
    try {
      const resultat = await retablirMessage({
        messageId,
        motif,
        noteInterne: note.trim() === '' ? undefined : note,
      })
      if (resultat.ok) {
        setRetour({
          type: resultat.deja ? 'deja' : 'succes',
          message: resultat.deja
            ? TEXTES_MODERATION.retablissementDeja
            : TEXTES_MODERATION.retablissementFait,
        })
        router.refresh()
        return
      }
      if (resultat.erreur === 'reauth') {
        setRetour({ type: 'reauth', message: TEXTES_MODERATION.reauthRequise })
      } else {
        setRetour({ type: 'erreur', message: TEXTES_MODERATION.retablissementEchoue })
      }
    } catch {
      setRetour({ type: 'erreur', message: TEXTES_MODERATION.retablissementEchoue })
    } finally {
      setEnCours(false)
    }
  }

  return (
    <section className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-card">
      <h2 className="text-base font-bold text-ink">{TEXTES_MODERATION.retablirTitre}</h2>
      <p className="mt-1 text-sm text-ink-muted">{TEXTES_MODERATION.retablirAide}</p>

      <div className="mt-4">
        <MessageRetour retour={retour} cheminRetour={cheminRetour} />
      </div>

      <div className="mt-4 max-w-sm space-y-3">
        <Select
          label={TEXTES_MODERATION.motifChamp}
          value={motif}
          options={OPTIONS_MOTIF_RETABLISSEMENT.map((option) => ({
            value: option.valeur,
            label: option.libelle,
          }))}
          onChange={(event) => setMotif(event.target.value)}
        />
        <Textarea
          label={TEXTES_MODERATION.noteChamp}
          value={note}
          rows={2}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button variant="secondary" onClick={() => void retablir()} disabled={enCours}>
          {TEXTES_MODERATION.retablirValider}
        </Button>
      </div>
    </section>
  )
}
