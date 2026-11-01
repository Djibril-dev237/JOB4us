import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { reactiverUtilisateur, suspendreUtilisateur } from '@/app/actions/admin-utilisateurs'
import { BandeauAdmin } from '@/components/admin/bandeau-admin'
import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { requireAdmin } from '@/lib/dal'
import { lireUtilisateurAdmin } from '@/lib/admin-utilisateurs-dal'
import {
  LIBELLES_ROLE_UTILISATEUR,
  LIBELLES_STATUT_COMPTE,
  TEXTES_ADMIN_UTILISATEURS,
} from '@/lib/admin-utilisateurs-labels'
import { OPTIONS_MOTIF_SUSPENSION_UTILISATEUR } from '@/lib/moderation-labels'

// ─── Détail d'un utilisateur — /admin/utilisateurs/[userId] (M10) ────────────
// Lecture seule pour les comptes admin et anonymisés. La suspension et la
// réactivation passent par des actions serveur qui vérifient le rôle, la
// réauthentification, l'état courant et écrivent l'audit dans la même
// transaction. Aucun CV, aucun secret TOTP, aucun mot de passe n'est lu.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: TEXTES_ADMIN_UTILISATEURS.titreDetail,
}

const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

function idUtilisateur(valeur: string): number | null {
  if (!/^[1-9][0-9]*$/.test(valeur)) return null
  const id = Number(valeur)
  return Number.isSafeInteger(id) ? id : null
}

function messageSucces(cle: string | null): string | null {
  if (cle === 'suspendu') return TEXTES_ADMIN_UTILISATEURS.suspendu
  if (cle === 'reactive') return TEXTES_ADMIN_UTILISATEURS.reactive
  return null
}

function messageErreur(cle: string | null): string | null {
  switch (cle) {
    case 'forme':
      return TEXTES_ADMIN_UTILISATEURS.erreurForme
    case 'admin':
      return TEXTES_ADMIN_UTILISATEURS.erreurAdmin
    case 'anonymise':
      return TEXTES_ADMIN_UTILISATEURS.erreurAnonymise
    case 'deja_suspendu':
      return TEXTES_ADMIN_UTILISATEURS.erreurDejaSuspendu
    case 'deja_actif':
      return TEXTES_ADMIN_UTILISATEURS.erreurDejaActif
    case 'statut':
      return TEXTES_ADMIN_UTILISATEURS.erreurStatut
    case 'inconnue':
      return TEXTES_ADMIN_UTILISATEURS.erreurInconnue
    default:
      return null
  }
}

export default async function PageAdminUtilisateur({
  params,
  searchParams,
}: PageProps<'/admin/utilisateurs/[userId]'>) {
  await requireAdmin()

  const { userId: userIdBrut } = await params
  const userId = idUtilisateur(userIdBrut)
  if (userId === null) notFound()

  const utilisateur = await lireUtilisateurAdmin(userId)
  if (utilisateur === null) notFound()

  const query = await searchParams
  const succes = messageSucces(paramUnique(query.maj))
  const echec = messageErreur(paramUnique(query.erreur))

  const estAdmin = utilisateur.role === 'admin'
  const estAnonymise = utilisateur.anonymizedAt !== null
  const modifiable = !estAdmin && !estAnonymise
  const statut = utilisateur.isActive ? 'actif' : 'suspendu'

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <EnTeteAdmin
        titre={utilisateur.name}
        description={TEXTES_ADMIN_UTILISATEURS.titreDetail}
        actions={
          <Link
            href="/admin/utilisateurs"
            className="text-sm font-medium text-brand transition-colors duration-fast hover:text-brand-dark"
          >
            {TEXTES_ADMIN_UTILISATEURS.retourListe}
          </Link>
        }
      />

      {succes !== null ? <BandeauAdmin variante="succes" message={succes} /> : null}
      {echec !== null ? <BandeauAdmin variante="erreur" message={echec} /> : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">
            {LIBELLES_ROLE_UTILISATEUR[utilisateur.role]}
          </Badge>
          {estAnonymise ? (
            <Badge variant="neutral">Anonymisé</Badge>
          ) : (
            <Badge variant={utilisateur.isActive ? 'ok' : 'danger'}>
              {LIBELLES_STATUT_COMPTE[statut]}
            </Badge>
          )}
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.email}
            </dt>
            <dd className="mt-1 min-w-0 break-words text-sm text-ink">
              {utilisateur.email ?? 'Non renseigné'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.telephone}
            </dt>
            <dd className="mt-1 min-w-0 break-words text-sm text-ink">
              {utilisateur.phone ?? 'Non renseigné'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.ville}
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {utilisateur.ville ?? 'Non renseignée'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.pays}
            </dt>
            <dd className="mt-1 text-sm text-ink">{utilisateur.pays}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.creeLe}
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {FORMATEUR_DATE.format(utilisateur.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.activite}
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {utilisateur.candidat !== null
                ? `${utilisateur.candidat.candidatures} candidature(s)`
                : utilisateur.entreprise !== null
                  ? `${utilisateur.entreprise.offres} offre(s)`
                  : 'Aucune activité métier'}
            </dd>
          </div>
        </dl>

        {utilisateur.candidat?.titreProfil !== null &&
        utilisateur.candidat?.titreProfil !== undefined ? (
          <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">
            Profil candidat : {utilisateur.candidat.titreProfil}
          </p>
        ) : null}
        {utilisateur.entreprise !== null ? (
          <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">
            Entreprise : {utilisateur.entreprise.nom}
          </p>
        ) : null}
      </Card>

      {estAdmin ? (
        <BandeauAdmin variante="info" message={TEXTES_ADMIN_UTILISATEURS.compteAdmin} />
      ) : null}
      {estAnonymise ? (
        <BandeauAdmin variante="info" message={TEXTES_ADMIN_UTILISATEURS.compteAnonymise} />
      ) : null}

      {modifiable ? (
        <Card>
          <h2 className="text-base font-bold text-ink">
            {utilisateur.isActive
              ? TEXTES_ADMIN_UTILISATEURS.suspendre
              : TEXTES_ADMIN_UTILISATEURS.reactiver}
          </h2>
          <form
            action={utilisateur.isActive ? suspendreUtilisateur : reactiverUtilisateur}
            className="mt-3 space-y-3"
          >
            <input type="hidden" name="userId" value={utilisateur.id} />
            <Select
              label={
                utilisateur.isActive
                  ? TEXTES_ADMIN_UTILISATEURS.motifSuspension
                  : TEXTES_ADMIN_UTILISATEURS.motifReactivation
              }
              name="motif"
              defaultValue={utilisateur.isActive ? 'securite' : 'demande_utilisateur'}
              options={OPTIONS_MOTIF_SUSPENSION_UTILISATEUR.map((option) => ({
                value: option.valeur,
                label: option.libelle,
              }))}
            />
            <Textarea
              label={TEXTES_ADMIN_UTILISATEURS.noteInterne}
              name="noteInterne"
              rows={3}
              maxLength={2000}
            />
            <p className="text-xs text-ink-muted">
              {TEXTES_ADMIN_UTILISATEURS.noteInterneAide}
            </p>
            <Button
              type="submit"
              variant={utilisateur.isActive ? 'danger' : 'secondary'}
            >
              {utilisateur.isActive
                ? TEXTES_ADMIN_UTILISATEURS.suspendre
                : TEXTES_ADMIN_UTILISATEURS.reactiver}
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  )
}
