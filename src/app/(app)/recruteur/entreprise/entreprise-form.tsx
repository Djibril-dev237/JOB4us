'use client'

import { useCallback, useEffect, useState, useActionState } from 'react'

import { uploadLogo } from '@/app/actions/files'
import { updateEntreprise } from '@/app/actions/profile'
import { initials } from '@/components/layout/avatar-menu'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TAILLE_ENTREPRISE_FORM } from '@/lib/definitions'

// ─── Formulaire du profil entreprise (M3-ST9) ────────────────────────────────
// Données : GET /api/entreprise (« moi » — page serveur synchrone #98097).
// Deux actions séparées : informations (whitelist EntrepriseSchema) et logo
// (chaîne fichiers M4 — clé UUID, R2 privée, bascule puis suppression).
// Aucun champ masqué ni donnée inventée : les valeurs vides s'affichent
// vides (état réel du compte).
// ---------------------------------------------------------------------------

interface EntrepriseData {
  nom: string
  secteurActivite: string
  tailleEntreprise: (typeof TAILLE_ENTREPRISE_FORM)[number] | ''
  description: string
  siteWeb: string
  emailContact: string
  telephone: string
  adresse: string
  ville: string
  pays: string
  logoUrl: string | null
  logoUpdatedAt: string
}

// Libellés EXACTS de la vue legacy recruteur/entreprise/edit.blade.php
// (« 11-50 employés »…) ; valeurs de champ identiques (definitions.ts).
const TAILLE_OPTIONS = TAILLE_ENTREPRISE_FORM.map((value) => ({
  value,
  label: `${value} employés`,
}))

const FILE_INPUT_CLASSES = [
  'block w-full text-sm text-ink',
  'file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-line-strong file:bg-surface',
  'file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface-alt',
].join(' ')

const ALERTE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'
const ALERTE_SUCCES =
  'rounded-sm border border-ok bg-ok-tint px-3 py-2 text-sm text-ok'

export function EntrepriseForm() {
  const [entreprise, setEntreprise] = useState<EntrepriseData | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  // Même shape que <ProfilForm /> : set d'état uniquement dans les callbacks
  // .then (react-hooks/set-state-in-effect), jamais dans le corps de l'effet.
  const recharger = useCallback(() => {
    fetch('/api/entreprise', { cache: 'no-store' })
      .then((response): Promise<EntrepriseData | null> => {
        if (!response.ok) {
          setErreur(
            response.status === 401
              ? 'Session expirée : reconnectez-vous.'
              : response.status === 403
                ? 'Cet espace est réservé aux comptes recruteurs.'
                : 'Impossible de charger le profil entreprise.',
          )
          return Promise.resolve(null)
        }
        return response.json() as Promise<EntrepriseData>
      })
      .then((data) => {
        if (data) {
          setErreur(null)
          setEntreprise(data)
        }
      })
      .catch(() => setErreur('Impossible de charger le profil entreprise (réseau indisponible).'))
      .finally(() => setChargement(false))
  }, [])

  useEffect(() => {
    recharger()
  }, [recharger])

  const [infosState, infosAction, infosPending] = useActionState(
    updateEntreprise,
    undefined,
  )
  const [logoState, logoAction, logoPending] = useActionState(uploadLogo, undefined)

  // Relecture après chaque envoi réussi (le serveur peut normaliser ;
  // logoUpdatedAt change à chaque écriture → revalidation du cache du <img>).
  useEffect(() => {
    if (!infosState?.message && !logoState?.message) return
    recharger()
  }, [infosState, logoState, recharger])

  if (chargement && !entreprise) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="h-36 animate-pulse rounded-md bg-surface-alt" />
        <div className="h-96 animate-pulse rounded-md bg-surface-alt" />
      </div>
    )
  }

  if (!entreprise) {
    return (
      <Card className="p-6">
        <p role="alert" className={ALERTE_ERREUR}>
          {erreur ?? 'Impossible de charger le profil entreprise.'}
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

      {/* ── Logo ────────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-ink">Logo de l&apos;entreprise</h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {entreprise.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- URL privée redirigée vers une signature de 5 minutes : l'optimiseur Next (cache d'images) contredirait le Cache-Control no-store de la route. */
            <img
              src={`${entreprise.logoUrl}&v=${entreprise.logoUpdatedAt}`}
              alt={`Logo de ${entreprise.nom}`}
              width={80}
              height={80}
              className="size-20 shrink-0 rounded-md border border-line bg-surface object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-20 shrink-0 items-center justify-center rounded-md border border-line bg-brand-tint text-xl font-semibold text-brand-dark"
            >
              {initials(entreprise.nom)}
            </span>
          )}

          <form action={logoAction} className="min-w-0 flex-1 space-y-3">
            {logoState?.errors?._form?.[0] && (
              <p role="alert" className={ALERTE_ERREUR}>
                {logoState.errors._form[0]}
              </p>
            )}
            {logoState?.message && (
              <p role="status" className={ALERTE_SUCCES}>
                {logoState.message}
              </p>
            )}
            <input
              type="file"
              name="logo"
              accept="image/jpeg,image/png,image/webp,image/gif"
              required
              className={FILE_INPUT_CLASSES}
            />
            <p className="text-xs text-ink-muted">
              Formats acceptés : JPG, PNG, WEBP ou GIF — 2 Mo maximum. Le SVG
              est refusé (sécurité).
            </p>
            <Button type="submit" disabled={logoPending}>
              {logoPending ? 'Envoi du logo…' : 'Changer le logo'}
            </Button>
          </form>
        </div>
      </Card>

      {/* ── Informations ────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold text-ink">Informations</h2>
        <form action={infosAction} className="mt-4 space-y-4">
          {infosState?.errors?._form?.[0] && (
            <p role="alert" className={ALERTE_ERREUR}>
              {infosState.errors._form[0]}
            </p>
          )}
          {infosState?.message && (
            <p role="status" className={ALERTE_SUCCES}>
              {infosState.message}
            </p>
          )}

          {/* Ordre des champs = vue legacy edit.blade.php (général →
              contact), regroupés ici en deux grilles responsive. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="nom"
              name="nom"
              type="text"
              label="Nom de l'entreprise"
              autoComplete="organization"
              required
              maxLength={150}
              className="sm:col-span-2"
              defaultValue={entreprise.nom}
              error={infosState?.errors?.nom?.[0]}
            />
            <Input
              id="secteurActivite"
              name="secteurActivite"
              type="text"
              label="Secteur d'activité"
              placeholder="Ex: Informatique & Tech"
              maxLength={150}
              defaultValue={entreprise.secteurActivite}
              error={infosState?.errors?.secteurActivite?.[0]}
            />
            <Select
              id="tailleEntreprise"
              name="tailleEntreprise"
              label="Taille de l'entreprise"
              options={TAILLE_OPTIONS}
              withEmpty
              emptyLabel="-- Choisir --"
              defaultValue={entreprise.tailleEntreprise}
              error={infosState?.errors?.tailleEntreprise?.[0]}
            />
          </div>

          <Textarea
            id="description"
            name="description"
            label="Description"
            rows={6}
            maxLength={10_000}
            placeholder="Décrivez votre entreprise, sa mission, ses valeurs..."
            defaultValue={entreprise.description}
            error={infosState?.errors?.description?.[0]}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="emailContact"
              name="emailContact"
              type="email"
              label="Email de contact"
              autoComplete="email"
              placeholder="contact@entreprise.com"
              maxLength={150}
              defaultValue={entreprise.emailContact}
              error={infosState?.errors?.emailContact?.[0]}
            />
            <Input
              id="telephone"
              name="telephone"
              type="tel"
              label="Téléphone"
              autoComplete="tel"
              placeholder="+237 6XX XXX XXX"
              maxLength={20}
              defaultValue={entreprise.telephone}
              error={infosState?.errors?.telephone?.[0]}
            />
            <Input
              id="siteWeb"
              name="siteWeb"
              type="url"
              label="Site web"
              placeholder="https://www.entreprise.com"
              maxLength={191}
              className="sm:col-span-2"
              defaultValue={entreprise.siteWeb}
              error={infosState?.errors?.siteWeb?.[0]}
            />
            <Input
              id="adresse"
              name="adresse"
              type="text"
              label="Adresse"
              autoComplete="street-address"
              placeholder="Rue, quartier..."
              maxLength={191}
              className="sm:col-span-2"
              defaultValue={entreprise.adresse}
              error={infosState?.errors?.adresse?.[0]}
            />
            <Input
              id="ville"
              name="ville"
              type="text"
              label="Ville"
              autoComplete="address-level2"
              placeholder="Douala"
              maxLength={100}
              defaultValue={entreprise.ville}
              error={infosState?.errors?.ville?.[0]}
            />
            <Input
              id="pays"
              name="pays"
              type="text"
              label="Pays"
              autoComplete="country-name"
              placeholder="Cameroun"
              maxLength={100}
              defaultValue={entreprise.pays}
              error={infosState?.errors?.pays?.[0]}
            />
          </div>

          <Button type="submit" disabled={infosPending}>
            {infosPending ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
