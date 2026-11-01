import type { Metadata } from 'next'
import type { Role } from '@prisma/client'
import Link from 'next/link'

import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { EtatVideAdmin } from '@/components/admin/etat-vide-admin'
import { Pagination } from '@/components/candidatures/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { requireAdmin } from '@/lib/dal'
import { listerUtilisateursAdmin } from '@/lib/admin-utilisateurs-dal'
import {
  LIBELLES_ROLE_UTILISATEUR,
  LIBELLES_STATUT_COMPTE,
  TEXTES_ADMIN_UTILISATEURS,
} from '@/lib/admin-utilisateurs-labels'

// ─── Liste des utilisateurs — /admin/utilisateurs (M10) ─────────────────────
// Recherche et filtres whitelistés, une seule requête de liste et un count
// sur le MÊME where. Les comptes admin sont affichés mais restent en lecture
// seule dans le détail. Aucune coordonnée sensible au-delà de l'email et du
// téléphone nécessaires au support.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: TEXTES_ADMIN_UTILISATEURS.titreListe,
}

const ROLES: Role[] = ['candidat', 'recruteur', 'admin']
const STATUTS = ['actif', 'suspendu'] as const
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function paramUnique(valeur: string | string[] | undefined): string | null {
  return typeof valeur === 'string' ? valeur : null
}

function pageDemandee(valeur: string | null): number {
  const entier = Math.trunc(Number(valeur ?? 1))
  return Number.isFinite(entier) ? Math.max(1, entier) : 1
}

export default async function PageAdminUtilisateurs({
  searchParams,
}: PageProps<'/admin/utilisateurs'>) {
  await requireAdmin()

  const params = await searchParams
  const q = (paramUnique(params.q) ?? '').trim().slice(0, 100)
  const roleBrut = paramUnique(params.role)
  const role = ROLES.includes(roleBrut as Role) ? (roleBrut as Role) : undefined
  const statutBrut = paramUnique(params.statut)
  const statut =
    statutBrut === 'actif' || statutBrut === 'suspendu' ? statutBrut : undefined
  const page = pageDemandee(paramUnique(params.page))

  const resultat = await listerUtilisateursAdmin({ q, role, statut, page })

  const parametres: Record<string, string | undefined> = {
    q: q === '' ? undefined : q,
    role,
    statut,
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <EnTeteAdmin
        titre={TEXTES_ADMIN_UTILISATEURS.titreListe}
        description={TEXTES_ADMIN_UTILISATEURS.descriptionListe}
      />

      <form
        method="get"
        className="grid gap-3 rounded-md border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]"
      >
        <Input
          label={TEXTES_ADMIN_UTILISATEURS.recherche}
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
        />
        <Select
          label={TEXTES_ADMIN_UTILISATEURS.filtreRole}
          name="role"
          withEmpty
          emptyLabel={TEXTES_ADMIN_UTILISATEURS.tousLesRoles}
          defaultValue={role ?? ''}
          options={ROLES.map((valeur) => ({
            value: valeur,
            label: LIBELLES_ROLE_UTILISATEUR[valeur],
          }))}
        />
        <Select
          label={TEXTES_ADMIN_UTILISATEURS.filtreStatut}
          name="statut"
          withEmpty
          emptyLabel={TEXTES_ADMIN_UTILISATEURS.tousLesStatuts}
          defaultValue={statut ?? ''}
          options={STATUTS.map((valeur) => ({
            value: valeur,
            label: LIBELLES_STATUT_COMPTE[valeur],
          }))}
        />
        <Button type="submit" className="self-end">
          Filtrer
        </Button>
      </form>

      <p className="text-sm text-ink-muted">
        {resultat.total} compte(s) trouvé(s)
      </p>

      <ul className="divide-y divide-line rounded-md border border-line bg-surface shadow-card">
        {resultat.lignes.length === 0 ? (
          <li>
            <EtatVideAdmin message={TEXTES_ADMIN_UTILISATEURS.listeVide} />
          </li>
        ) : (
          resultat.lignes.map((utilisateur) => {
            const statutAffiche = utilisateur.isActive ? 'actif' : 'suspendu'
            return (
              <li
                key={utilisateur.id}
                className="flex flex-wrap items-start gap-3 p-3"
              >
                <div className="min-w-0 grow basis-64">
                  <h2 className="min-w-0 break-words text-sm font-semibold text-ink">
                    <Link
                      href={`/admin/utilisateurs/${utilisateur.id}`}
                      className="transition-colors duration-fast hover:text-brand"
                    >
                      {utilisateur.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 min-w-0 break-words text-xs text-ink-muted">
                    {utilisateur.email ?? 'Email non renseigné'}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <span>{LIBELLES_ROLE_UTILISATEUR[utilisateur.role]}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={utilisateur.createdAt.toISOString()}>
                      Créé le {FORMATEUR_DATE.format(utilisateur.createdAt)}
                    </time>
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {utilisateur.anonymizedAt !== null ? (
                    <Badge variant="neutral">Anonymisé</Badge>
                  ) : (
                    <Badge variant={utilisateur.isActive ? 'ok' : 'danger'}>
                      {LIBELLES_STATUT_COMPTE[statutAffiche]}
                    </Badge>
                  )}
                </div>
              </li>
            )
          })
        )}
      </ul>

      <Pagination
        page={resultat.page}
        pages={resultat.pages}
        chemin="/admin/utilisateurs"
        parametres={parametres}
        ariaLabel={TEXTES_ADMIN_UTILISATEURS.pagination}
      />
    </div>
  )
}
