'use client'

import { useCallback, useEffect, useState, useActionState } from 'react'

import { uploadAvatar, uploadCv } from '@/app/actions/files'
import { updateProfilCandidat } from '@/app/actions/profile'
import { initials } from '@/components/layout/avatar-menu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { DisponibiliteForm } from '@/lib/definitions'

// ─── Formulaire du profil candidat (M3-ST8) ──────────────────────────────────
// Données : GET /api/profile (route handler « moi » — la page serveur reste
// synchrone, règle #98097). Après CHAQUE envoi réussi, la source de vérité
// est relue (le serveur peut normaliser ; hasCv et l'avatar changent).
// Trois actions séparées (whitelist M1 / envoi M4) : infos, avatar, CV.
//
// Champs non remplis = états vides rendus tels quels : aucune donnée
// inventée (anti-vibecoding), aucun champ masqué « pour faire joli ».
// ---------------------------------------------------------------------------

interface CompetenceOption {
  id: number
  nom: string
}

interface ProfilData {
  candidatId: number
  name: string
  phone: string
  ville: string
  avatarUrl: string | null
  avatarUpdatedAt: string
  titreProfil: string
  resume: string
  dateNaissance: string
  genre: 'homme' | 'femme' | 'autre' | ''
  disponibilite: DisponibiliteForm | ''
  competences: number[]
  hasCv: boolean
  competencesDisponibles: CompetenceOption[]
}

// Libellés des énumérations : la vue Blade du profil n'est PAS dans la copie
// d'audit (non vérifiable) — libellés neutres choisis ici, valeurs de champ
// identiques au legacy (cf. definitions.ts).
const GENRE_OPTIONS = [
  { value: 'homme', label: 'Homme' },
  { value: 'femme', label: 'Femme' },
  { value: 'autre', label: 'Autre' },
]

const DISPONIBILITE_OPTIONS = [
  { value: 'immediat', label: 'Disponible immédiatement' },
  { value: '1_mois', label: 'Sous 1 mois' },
  { value: '3_mois', label: 'Sous 3 mois' },
  { value: 'non_disponible', label: 'Non disponible' },
]

const FILE_INPUT_CLASSES = [
  'block w-full text-sm text-ink',
  'file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-line-strong file:bg-surface',
  'file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-alt',
].join(' ')

const ALERTE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'
const ALERTE_SUCCES =
  'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

export function ProfilForm() {
  const [profil, setProfil] = useState<ProfilData | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  // Lecture de la source de vérité. Chaînes .then (et non async/await) :
  // le set d'état n'a lieu QUE dans des callbacks, jamais dans le corps de
  // l'effet — conformément à react-hooks/set-state-in-effect (même shape que
  // <HomeStats />). Le composant non monté ignore les réponses tardives.
  const recharger = useCallback(() => {
    fetch('/api/profile', { cache: 'no-store' })
      .then((response): Promise<ProfilData | null> => {
        if (!response.ok) {
          setErreur(
            response.status === 401
              ? 'Session expirée : reconnectez-vous.'
              : response.status === 403
                ? 'Cet espace est réservé aux comptes candidats.'
                : 'Impossible de charger le profil.',
          )
          return Promise.resolve(null)
        }
        return response.json() as Promise<ProfilData>
      })
      .then((data) => {
        if (data) {
          setErreur(null)
          setProfil(data)
        }
      })
      .catch(() => setErreur('Impossible de charger le profil (réseau indisponible).'))
      .finally(() => setChargement(false))
  }, [])

  useEffect(() => {
    recharger()
  }, [recharger])

  const [profilState, profilAction, profilPending] = useActionState(
    updateProfilCandidat,
    undefined,
  )
  const [cvState, cvAction, cvPending] = useActionState(uploadCv, undefined)
  const [avatarState, avatarAction, avatarPending] = useActionState(uploadAvatar, undefined)

  // Relecture après chaque action réussie (identité des objets de retour, pas
  // le texte du message : deux envois identiques doivent repartir chercher ;
  // le nouveau avatarUpdatedAt du profil revalide alors le cache du <img>).
  useEffect(() => {
    if (!profilState?.message && !cvState?.message && !avatarState?.message) return
    recharger()
  }, [profilState, cvState, avatarState, recharger])

  if (chargement && !profil) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="h-36 animate-pulse rounded-md bg-surface-alt" />
        <div className="h-96 animate-pulse rounded-md bg-surface-alt" />
        <div className="h-40 animate-pulse rounded-md bg-surface-alt" />
      </div>
    )
  }

  if (!profil) {
    return (
      <Card className="p-6">
        <p role="alert" className={ALERTE_ERREUR}>
          {erreur ?? 'Impossible de charger le profil.'}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setChargement(true)
            recharger()
          }}
        >
          Réessayer
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {erreur && (
        <p role="alert" className={ALERTE_ERREUR}>
          {erreur}
        </p>
      )}

      {/* ── Photo de profil ─────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-ink">Photo de profil</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {profil.avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- URL privée redirigée vers une signature de 5 minutes : l'optimiseur Next (cache d'images) contredirait le Cache-Control no-store de la route. */
            <img
              src={`${profil.avatarUrl}&v=${profil.avatarUpdatedAt}`}
              alt="Photo de profil"
              width={80}
              height={80}
              className="size-20 shrink-0 rounded-full border border-line object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-20 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xl font-semibold text-brand-dark"
            >
              {initials(profil.name)}
            </span>
          )}

          <form action={avatarAction} className="min-w-0 flex-1 space-y-3">
            {avatarState?.errors?._form?.[0] && (
              <p role="alert" className={ALERTE_ERREUR}>
                {avatarState.errors._form[0]}
              </p>
            )}
            {avatarState?.message && (
              <p role="status" className={ALERTE_SUCCES}>
                {avatarState.message}
              </p>
            )}
            <input
              type="file"
              name="avatar"
              accept="image/jpeg,image/png,image/webp,image/gif"
              required
              className={FILE_INPUT_CLASSES}
            />
            <p className="text-xs text-ink-muted">
              Formats acceptés : JPG, PNG, WEBP ou GIF — 2 Mo maximum. Le SVG
              est refusé (sécurité).
            </p>
            <Button type="submit" disabled={avatarPending}>
              {avatarPending ? 'Envoi de la photo…' : 'Changer la photo'}
            </Button>
          </form>
        </div>
      </Card>

      {/* ── Informations ────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-ink">Informations</h2>
        <form action={profilAction} className="mt-4 space-y-4">
          {profilState?.errors?._form?.[0] && (
            <p role="alert" className={ALERTE_ERREUR}>
              {profilState.errors._form[0]}
            </p>
          )}
          {profilState?.message && (
            <p role="status" className={ALERTE_SUCCES}>
              {profilState.message}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="name"
              name="name"
              type="text"
              label="Nom complet"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={profil.name}
              error={profilState?.errors?.name?.[0]}
            />
            <Input
              id="phone"
              name="phone"
              type="tel"
              label="Téléphone"
              autoComplete="tel"
              placeholder="+237 6 00 00 00 00"
              defaultValue={profil.phone}
              error={profilState?.errors?.phone?.[0]}
            />
            <Input
              id="ville"
              name="ville"
              type="text"
              label="Ville"
              autoComplete="address-level2"
              maxLength={100}
              defaultValue={profil.ville}
              error={profilState?.errors?.ville?.[0]}
            />
            <Input
              id="titreProfil"
              name="titreProfil"
              type="text"
              label="Titre du profil"
              maxLength={150}
              defaultValue={profil.titreProfil}
              error={profilState?.errors?.titreProfil?.[0]}
            />
          </div>

          <Textarea
            id="resume"
            name="resume"
            label="Résumé"
            rows={4}
            maxLength={10_000}
            defaultValue={profil.resume}
            error={profilState?.errors?.resume?.[0]}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="dateNaissance"
              name="dateNaissance"
              type="date"
              label="Date de naissance"
              defaultValue={profil.dateNaissance}
              error={profilState?.errors?.dateNaissance?.[0]}
            />
            <Select
              id="genre"
              name="genre"
              label="Genre"
              options={GENRE_OPTIONS}
              withEmpty
              emptyLabel="Non renseigné"
              defaultValue={profil.genre}
              error={profilState?.errors?.genre?.[0]}
            />
            <Select
              id="disponibilite"
              name="disponibilite"
              label="Disponibilité"
              options={DISPONIBILITE_OPTIONS}
              defaultValue={profil.disponibilite}
              error={profilState?.errors?.disponibilite?.[0]}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Compétences</legend>
            {profil.competencesDisponibles.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                Aucune compétence au catalogue pour le moment.
              </p>
            ) : (
              <div className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-sm border border-line p-2 sm:grid-cols-2">
                {profil.competencesDisponibles.map((competence) => (
                  <label
                    key={competence.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm text-ink hover:bg-surface-alt"
                  >
                    <input
                      type="checkbox"
                      name="competences"
                      value={competence.id}
                      defaultChecked={profil.competences.includes(competence.id)}
                      className="size-4 shrink-0 accent-brand"
                    />
                    <span className="truncate">{competence.nom}</span>
                  </label>
                ))}
              </div>
            )}
            {profilState?.errors?.competences?.[0] && (
              <p className="mt-1.5 text-xs text-danger">
                {profilState.errors.competences[0]}
              </p>
            )}
          </fieldset>

          <Button type="submit" disabled={profilPending}>
            {profilPending ? 'Enregistrement…' : 'Enregistrer les informations'}
          </Button>
        </form>
      </Card>

      {/* ── CV ──────────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-ink">Curriculum vitæ</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Stocké de façon privée : il n&apos;est accessible qu&apos;à vous,
          aux recruteurs ayant reçu une candidature de votre part et aux
          administrateurs (journalisés).
        </p>
        <form action={cvAction} className="mt-4 space-y-3">
          {cvState?.errors?._form?.[0] && (
            <p role="alert" className={ALERTE_ERREUR}>
              {cvState.errors._form[0]}
            </p>
          )}
          {cvState?.message && (
            <p role="status" className={ALERTE_SUCCES}>
              {cvState.message}
            </p>
          )}
          <input
            type="file"
            name="cv"
            accept=".pdf,.doc,.docx,application/pdf"
            required
            className={FILE_INPUT_CLASSES}
          />
          <p className="text-xs text-ink-muted">
            Formats acceptés : PDF, DOC, DOCX — 5 Mo maximum.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={cvPending}>
              {cvPending ? 'Envoi du CV…' : profil.hasCv ? 'Remplacer le CV' : 'Envoyer le CV'}
            </Button>
            {profil.hasCv && (
              <a
                href={`/api/files/cv?candidatId=${profil.candidatId}`}
                className="text-sm font-medium text-brand hover:underline"
              >
                Télécharger mon CV actuel
              </a>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
