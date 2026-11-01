import type { Metadata } from 'next'

import { EnTeteAdmin } from '@/components/admin/en-tete-admin'
import { EtatVideAdmin } from '@/components/admin/etat-vide-admin'
import { Pagination } from '@/components/candidatures/pagination'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { requireAdmin } from '@/lib/dal'
import {
  lireFiltresAudit,
  OPTIONS_ACTION_AUDIT,
  OPTIONS_CIBLE_AUDIT,
  OPTIONS_MOTIF_AUDIT,
  OPTIONS_SOURCE_AUDIT,
} from '@/lib/audit-url'
import { lireJournalAudit } from '@/lib/journal-audit'
import {
  libelleActionAudit,
  libelleCibleAudit,
  libelleSourceAudit,
} from '@/lib/journal-audit-labels'
import { libelleMotif } from '@/lib/moderation-labels'

// ─── Journal d'audit — /admin/audit (M10) ───────────────────────────────────
// La vue MySQL agrège le journal générique et les journaux M7/M8. Les filtres
// sont validés contre des catalogues fermés ; l'export est une route séparée,
// elle aussi gardée et auditée. Aucun bouton de modification ou de suppression
// n'existe : le journal est append-only par construction.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Journal d'audit",
}

const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function pageCourante(valeur: string | null): number {
  const entier = Math.trunc(Number(valeur ?? 1))
  return Number.isFinite(entier) ? Math.max(1, entier) : 1
}

function versSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const sp = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(params)) {
    if (typeof valeur === 'string') sp.set(cle, valeur)
  }
  return sp
}

export default async function PageAdminAudit({
  searchParams,
}: PageProps<'/admin/audit'>) {
  await requireAdmin()

  const params = await searchParams
  const sp = versSearchParams(params)
  const { filtres, parametres } = lireFiltresAudit(sp)
  const page = pageCourante(sp.get('page'))
  const resultat = await lireJournalAudit(filtres, page, 25)

  const exportParams = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(parametres)) {
    if (valeur !== undefined) exportParams.set(cle, valeur)
  }
  const exportQuery = exportParams.toString()
  const hrefExport = `/admin/audit/export${exportQuery === '' ? '' : `?${exportQuery}`}`

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <EnTeteAdmin
        titre="Journal d'audit"
        description="Trace en ajout pur des actions sensibles et des consultations de contenus privés."
        actions={
          <a
            href={hrefExport}
            className="inline-flex h-9 items-center rounded-sm border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-alt"
          >
            Exporter en CSV
          </a>
        }
      />

      <form
        method="get"
        className="grid gap-3 rounded-md border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4"
      >
        <Select
          label="Source"
          name="source"
          withEmpty
          emptyLabel="Toutes les sources"
          defaultValue={parametres.source ?? ''}
          options={OPTIONS_SOURCE_AUDIT.map((source) => ({
            value: source,
            label: libelleSourceAudit(source),
          }))}
        />
        <Select
          label="Action"
          name="action"
          withEmpty
          emptyLabel="Toutes les actions"
          defaultValue={parametres.action ?? ''}
          options={OPTIONS_ACTION_AUDIT.map((action) => ({
            value: action,
            label: libelleActionAudit(action),
          }))}
        />
        <Select
          label="Cible"
          name="cibleType"
          withEmpty
          emptyLabel="Toutes les cibles"
          defaultValue={parametres.cibleType ?? ''}
          options={OPTIONS_CIBLE_AUDIT.map((cible) => ({
            value: cible,
            label: libelleCibleAudit(cible),
          }))}
        />
        <Select
          label="Motif"
          name="motif"
          withEmpty
          emptyLabel="Tous les motifs"
          defaultValue={parametres.motif ?? ''}
          options={OPTIONS_MOTIF_AUDIT.map((motif) => ({
            value: motif,
            label: libelleMotif(motif),
          }))}
        />
        <Input
          label="Identifiant acteur"
          name="acteurId"
          inputMode="numeric"
          defaultValue={parametres.acteurId ?? ''}
        />
        <Input
          label="Identifiant cible"
          name="cibleId"
          inputMode="numeric"
          defaultValue={parametres.cibleId ?? ''}
        />
        <Input
          label="Du"
          name="du"
          type="date"
          defaultValue={parametres.du ?? ''}
        />
        <Input
          label="Au"
          name="au"
          type="date"
          defaultValue={parametres.au ?? ''}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit">Filtrer</Button>
        </div>
      </form>

      <p className="text-sm text-ink-muted">
        {resultat.total} entrée(s) d’audit
      </p>

      <ul className="divide-y divide-line rounded-md border border-line bg-surface shadow-card">
        {resultat.lignes.length === 0 ? (
          <li>
            <EtatVideAdmin message="Aucune entrée d’audit pour ces filtres." />
          </li>
        ) : (
          resultat.lignes.map((ligne) => (
            <li key={`${ligne.source}-${ligne.entreeId}`} className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="min-w-0 break-words text-sm font-semibold text-ink">
                    {libelleActionAudit(ligne.action)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <span>{libelleSourceAudit(ligne.source)}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={ligne.createdAt.toISOString()}>
                      {FORMATEUR_DATE.format(ligne.createdAt)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>Acteur {ligne.acteurNom ?? `#${ligne.acteurId}`}</span>
                  </p>
                </div>
                <p className="shrink-0 text-xs text-ink-muted">
                  {libelleCibleAudit(ligne.cibleType)}
                  {ligne.cibleId === null ? '' : ` #${ligne.cibleId}`}
                </p>
              </div>
              {ligne.motif !== null ? (
                <p className="mt-2 text-xs text-ink-muted">
                  Motif : {libelleMotif(ligne.motif)}
                </p>
              ) : null}
              {ligne.commentaire !== null ? (
                <p className="mt-2 min-w-0 whitespace-pre-wrap break-words text-sm text-ink">
                  {ligne.commentaire}
                </p>
              ) : null}
            </li>
          ))
        )}
      </ul>

      <Pagination
        page={resultat.page}
        pages={resultat.pages}
        chemin="/admin/audit"
        parametres={parametres}
        ariaLabel="Pagination du journal d'audit"
      />
    </div>
  )
}
