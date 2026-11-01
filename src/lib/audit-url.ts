import { minuitDouala } from '@/lib/douala'
import type { FiltresJournalAudit } from '@/lib/journal-audit'
import {
  ACTIONS_AUDIT,
  CIBLES_AUDIT,
  estActionAudit,
  estCibleAudit,
  estSourceAudit,
  SOURCES_AUDIT,
} from '@/lib/journal-audit-labels'
import { estMotifAudit, MOTIFS_AUDIT } from '@/lib/moderation-labels'

// ─── Lecture des filtres du journal d'audit (M10) ───────────────────────────
// Toutes les valeurs d'URL sont validées contre les catalogues fermés. Une
// valeur inconnue est ignorée, jamais transformée en texte affiché. Les dates
// civiles sont interprétées à Douala, avec une borne haute inclusive.
// ---------------------------------------------------------------------------

export interface FiltresAuditPage {
  filtres: FiltresJournalAudit
  parametres: Record<string, string | undefined>
}

const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/
const ID_POSITIF = /^[1-9][0-9]*$/

function valeur(sp: URLSearchParams, cle: string): string | undefined {
  const brut = sp.get(cle)
  return brut === null || brut === '' ? undefined : brut
}

function dateCivile(sp: URLSearchParams, cle: string): Date | undefined {
  const brut = valeur(sp, cle)
  if (brut === undefined || !DATE_CIVILE.test(brut)) return undefined
  const [annee, mois, jour] = brut.split('-').map(Number)
  const verif = new Date(Date.UTC(annee ?? 0, (mois ?? 0) - 1, jour ?? 0))
  if (
    verif.getUTCFullYear() !== annee ||
    verif.getUTCMonth() !== (mois ?? 0) - 1 ||
    verif.getUTCDate() !== jour
  ) {
    return undefined
  }
  const debut = minuitDouala(brut)
  if (Number.isNaN(debut.getTime())) return undefined
  return cle === 'au' ? new Date(debut.getTime() + 24 * 60 * 60 * 1000 - 1) : debut
}

function identifiant(sp: URLSearchParams, cle: string): number | undefined {
  const brut = valeur(sp, cle)
  if (brut === undefined || !ID_POSITIF.test(brut)) return undefined
  const id = Number(brut)
  return Number.isSafeInteger(id) ? id : undefined
}

export function lireFiltresAudit(sp: URLSearchParams): FiltresAuditPage {
  const source = valeur(sp, 'source')
  const action = valeur(sp, 'action')
  const cibleType = valeur(sp, 'cibleType')
  const motif = valeur(sp, 'motif')
  const acteurId = identifiant(sp, 'acteurId')
  const cibleId = identifiant(sp, 'cibleId')
  const du = dateCivile(sp, 'du')
  const au = dateCivile(sp, 'au')

  const filtres: FiltresJournalAudit = {}
  if (estSourceAudit(source)) filtres.source = source
  if (estActionAudit(action)) filtres.action = action
  if (estCibleAudit(cibleType)) filtres.cibleType = cibleType
  if (estMotifAudit(motif)) filtres.motif = motif
  if (acteurId !== undefined) filtres.acteurId = acteurId
  if (cibleId !== undefined) filtres.cibleId = cibleId
  if (du !== undefined) filtres.du = du
  if (au !== undefined) filtres.au = au

  const parametres: Record<string, string | undefined> = {
    source: filtres.source,
    action: filtres.action,
    cibleType: filtres.cibleType,
    motif: filtres.motif,
    acteurId: acteurId === undefined ? undefined : String(acteurId),
    cibleId: cibleId === undefined ? undefined : String(cibleId),
    du: du === undefined ? undefined : valeur(sp, 'du'),
    au: au === undefined ? undefined : valeur(sp, 'au'),
  }

  return { filtres, parametres }
}

/** Valeurs proposées dans les filtres (source unique, jamais recopiées). */
export const OPTIONS_SOURCE_AUDIT = SOURCES_AUDIT
export const OPTIONS_ACTION_AUDIT = ACTIONS_AUDIT
export const OPTIONS_CIBLE_AUDIT = CIBLES_AUDIT
export const OPTIONS_MOTIF_AUDIT = MOTIFS_AUDIT
