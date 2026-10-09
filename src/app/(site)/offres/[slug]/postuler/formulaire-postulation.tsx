'use client'

import { useState } from 'react'

import { postulerOffre } from '@/app/actions/candidatures'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

// ─── Formulaire de postulation (M7, composant CLIENT) ────────────────────────
//
// `<form action={postulerOffre}>` DIRECTEMENT : pas de useActionState —
// l'action ne renvoie aucun FormState, elle redirige toujours
// (/offres/<slug>/postuler?maj=envoyee ou ?erreur=<cle>), motif des actions M6/M7.
//
// État local minimal :
//  * `lettre` alimente le compteur de caractères (aria-live polite) ;
//  * `sourceCv` pilote la révélation du champ de fichier (un fichier qui
//    reste dans le DOM quand la source vaut `profil` ferait échouer
//    schemaPostulation côté serveur) ;
//  * `envoye` verrouille le bouton après le premier submit (double-clic
//    côté client — l'unicité est garantie par le serveur : doublon +
//    contrainte (offreId, candidatId) en base).
//
// Styles : tokens M2 uniquement, motifs de profil-form.tsx (FILE_INPUT
// identique, labels associés, accent-brand) ; transitions en duration-fast.
// ---------------------------------------------------------------------------

/** Jauge de la lettre — borne identique à `schemaPostulation` (3000). */
const MAX_LETTRE = 3000

/** Motif de fichier de profil-form.tsx (bouton natif du navigateur). */
const FILE_INPUT_CLASSES = [
  'block w-full text-sm text-ink',
  'file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-line-strong file:bg-surface',
  'file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-alt',
].join(' ')

/** Ligne d'option cliquable (motif des cases du formulaire de profil). */
const CLASSE_OPTION =
  'flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm text-ink hover:bg-surface-alt'

const CLASSE_CASE = 'size-4 shrink-0 accent-brand'

interface FormulairePostulationProps {
  /** Slug de l'offre (input caché : l'action lit `slug` du FormData). */
  slug: string
  /** Un CV est déjà rattaché au profil ? (faux → option « profil » désactivée) */
  aProfilCv: boolean
}

export function FormulairePostulation({ slug, aProfilCv }: FormulairePostulationProps) {
  const [lettre, setLettre] = useState('')
  const [sourceCv, setSourceCv] = useState<'profil' | 'fichier'>(aProfilCv ? 'profil' : 'fichier')
  const [envoye, setEnvoye] = useState(false)

  return (
    <form
      action={postulerOffre}
      onSubmit={() => setEnvoye(true)}
      className="space-y-4"
    >
      <input type="hidden" name="slug" value={slug} />

      <div className="space-y-1.5">
        <Textarea
          id="lettreMotivation"
          name="lettreMotivation"
          label="Lettre de motivation (facultatif)"
          rows={6}
          maxLength={MAX_LETTRE}
          value={lettre}
          onChange={(event) => setLettre(event.target.value)}
          aria-describedby="compteur-lettre"
        />
        <p id="compteur-lettre" aria-live="polite" className="text-xs text-ink-muted">
          {lettre.length} / {MAX_LETTRE}
        </p>
      </div>

      <div className="space-y-1">
        <label className={CLASSE_OPTION}>
          <input
            type="radio"
            name="sourceCv"
            value="profil"
            required
            checked={sourceCv === 'profil'}
            disabled={!aProfilCv}
            onChange={() => setSourceCv('profil')}
            className={CLASSE_CASE}
          />
          <span>Utiliser le CV de profil</span>
        </label>

        <label className={CLASSE_OPTION}>
          <input
            type="radio"
            name="sourceCv"
            value="fichier"
            required
            checked={sourceCv === 'fichier'}
            onChange={() => setSourceCv('fichier')}
            className={CLASSE_CASE}
          />
          <span>Téléverser un autre CV</span>
        </label>

        {sourceCv === 'fichier' ? (
          <input
            type="file"
            name="fichier"
            accept=".pdf,.doc,.docx,application/pdf"
            required
            className={`${FILE_INPUT_CLASSES} mt-2`}
          />
        ) : null}
      </div>

      <Button type="submit" disabled={envoye} aria-busy={envoye}>
        Envoyer ma candidature
      </Button>
    </form>
  )
}
