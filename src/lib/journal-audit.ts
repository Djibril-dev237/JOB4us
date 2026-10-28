import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { Prisma as PrismaRuntime } from '@prisma/client'

import {
  estSourceAudit,
  type ActionAudit,
  type ActionAuditGenerique,
  type CibleAudit,
  type CibleAuditGenerique,
  type SourceAudit,
} from '@/lib/journal-audit-labels'
import { type MotifAudit } from '@/lib/moderation-labels'
import { prisma } from '@/lib/prisma'

// ─── Journal d'audit générique (M10) ────────────────────────────────────────
//
// Écriture append-only dans `journal_audit` (aucune clé étrangère). La lecture
// passe par la vue `vue_journal_audit`, qui agrège aussi les journaux M7/M8 :
// une seule page admin, sans duplication de données.
//
// Règles :
//  * l'écriture se fait AVANT l'effet sensible (fail-closed) ; le client
//    transactif peut être fourni par l'appelant pour rendre l'ensemble atomique ;
//  * la fonction d'écriture n'accepte que les actions M10 (`ActionAuditGenerique`)
//    et les cibles M10 (`CibleAuditGenerique`) : une action historique ne peut
//    pas être réinjectée par erreur ;
//  * la lecture est paginée et bornée ; l'export est plafonné à 5000 lignes ;
//  * aucune exception n'est rattrapée ici : l'appelant décide du fail-closed.
// ---------------------------------------------------------------------------

export const MAX_LIGNES_PAGE_AUDIT = 100
export const MAX_LIGNES_EXPORT_AUDIT = 5000

export interface EntreeJournalAudit {
  acteurId: number
  action: ActionAuditGenerique
  cibleType: CibleAuditGenerique
  cibleId?: number | null
  motif?: MotifAudit | null
  commentaire?: string | null
}

/**
 * Consigne une action sensible. Le commentaire interne est nettoyé et borné :
 * un note libre ne doit pas devenir une colonne illimitée. Le motif reste
 * fermé par le type ; la validation métier appartient à l'action appelante.
 */
export async function consignerAudit(
  db: PrismaClient | Prisma.TransactionClient,
  entree: EntreeJournalAudit,
): Promise<void> {
  const commentaire = entree.commentaire?.trim().slice(0, 2000) || null
  await db.journalAudit.create({
    data: {
      acteurId: entree.acteurId,
      action: entree.action,
      cibleType: entree.cibleType,
      cibleId: entree.cibleId ?? null,
      motif: entree.motif ?? null,
      commentaire,
    },
  })
}

export interface FiltresJournalAudit {
  source?: SourceAudit
  action?: ActionAudit
  acteurId?: number
  cibleType?: CibleAudit
  cibleId?: number
  motif?: MotifAudit
  du?: Date
  au?: Date
}

export interface LigneJournalAudit {
  source: SourceAudit
  entreeId: number
  acteurId: number
  acteurNom: string | null
  action: string
  cibleType: CibleAudit
  cibleId: number | null
  motif: string | null
  commentaire: string | null
  createdAt: Date
}

export interface ResultatJournalAudit {
  lignes: LigneJournalAudit[]
  total: number
  page: number
  taille: number
  pages: number
}

interface LigneJournalAuditSql {
  source: string
  entree_id: number
  acteur_id: number
  acteur_nom: string | null
  action: string
  cible_type: string
  cible_id: number | null
  motif: string | null
  commentaire: string | null
  created_at: Date
}

interface TotalAuditSql {
  total: bigint | number
}

function normaliserPage(page: number | undefined): number {
  const valeur = Number.isFinite(page) ? Math.trunc(page as number) : 1
  return Math.max(1, valeur)
}

function normaliserTaille(taille: number | undefined, maximum: number): number {
  const valeur = Number.isFinite(taille) ? Math.trunc(taille as number) : 25
  return Math.min(maximum, Math.max(1, valeur))
}

/**
 * Construit la clause WHERE de la vue. Les dates sont inversées si la borne
 * basse dépasse la borne haute, plutôt que de renvoyer une erreur 500 depuis
 * un filtre d'URL. Les valeurs restent paramétrées par Prisma.sql.
 */
function clauseAudit(filtres: FiltresJournalAudit): Prisma.Sql {
  const conditions: Prisma.Sql[] = []
  if (filtres.source) {
    conditions.push(PrismaRuntime.sql`v.source = ${filtres.source}`)
  }
  if (filtres.action) {
    conditions.push(PrismaRuntime.sql`v.action = ${filtres.action}`)
  }
  if (filtres.acteurId !== undefined) {
    conditions.push(PrismaRuntime.sql`v.acteur_id = ${filtres.acteurId}`)
  }
  if (filtres.cibleType) {
    conditions.push(PrismaRuntime.sql`v.cible_type = ${filtres.cibleType}`)
  }
  if (filtres.cibleId !== undefined) {
    conditions.push(PrismaRuntime.sql`v.cible_id = ${filtres.cibleId}`)
  }
  if (filtres.motif) {
    conditions.push(PrismaRuntime.sql`v.motif = ${filtres.motif}`)
  }

  let du = filtres.du
  let au = filtres.au
  if (du && au && du.getTime() > au.getTime()) {
    ;[du, au] = [au, du]
  }
  if (du) {
    conditions.push(PrismaRuntime.sql`v.created_at >= ${du}`)
  }
  if (au) {
    conditions.push(PrismaRuntime.sql`v.created_at <= ${au}`)
  }

  return conditions.length > 0
    ? PrismaRuntime.sql`WHERE ${PrismaRuntime.join(conditions, ' AND ')}`
    : PrismaRuntime.empty
}

function mapperLigne(ligne: LigneJournalAuditSql): LigneJournalAudit {
  return {
    source: estSourceAudit(ligne.source) ? ligne.source : 'generique',
    entreeId: ligne.entree_id,
    acteurId: ligne.acteur_id,
    acteurNom: ligne.acteur_nom,
    action: ligne.action,
    cibleType: ligne.cible_type as CibleAudit,
    cibleId: ligne.cible_id,
    motif: ligne.motif,
    commentaire: ligne.commentaire,
    createdAt: ligne.created_at,
  }
}

async function requeterJournalAudit(
  filtres: FiltresJournalAudit,
  page: number,
  taille: number,
): Promise<ResultatJournalAudit> {
  const clause = clauseAudit(filtres)
  const offset = (page - 1) * taille

  const [lignesSql, totalSql] = await Promise.all([
    prisma.$queryRaw<LigneJournalAuditSql[]>`
      SELECT
        v.source,
        v.entree_id,
        v.acteur_id,
        u.name AS acteur_nom,
        v.action,
        v.cible_type,
        v.cible_id,
        v.motif,
        v.commentaire,
        v.created_at
      FROM vue_journal_audit v
      LEFT JOIN users u ON u.id = v.acteur_id
      ${clause}
      ORDER BY v.created_at DESC, v.source ASC, v.entree_id DESC
      LIMIT ${taille} OFFSET ${offset}
    `,
    prisma.$queryRaw<TotalAuditSql[]>`
      SELECT COUNT(*) AS total
      FROM vue_journal_audit v
      ${clause}
    `,
  ])

  const total = Number(totalSql[0]?.total ?? 0)
  return {
    lignes: lignesSql.map(mapperLigne),
    total,
    page,
    taille,
    pages: Math.max(1, Math.ceil(total / taille)),
  }
}

/** Lecture paginée pour la page admin (taille maximale : 100 lignes). */
export async function lireJournalAudit(
  filtres: FiltresJournalAudit = {},
  pageDemandee?: number,
  tailleDemandee?: number,
): Promise<ResultatJournalAudit> {
  const page = normaliserPage(pageDemandee)
  const taille = normaliserTaille(tailleDemandee, MAX_LIGNES_PAGE_AUDIT)
  return requeterJournalAudit(filtres, page, taille)
}

/**
 * Lecture pour l'export CSV. Le plafond est volontairement dur : un export
 * d'audit ne doit pas charger une table entière en mémoire. Le total permet à
 * l'action de signaler une troncature.
 */
export async function lireJournalAuditPourExport(
  filtres: FiltresJournalAudit = {},
): Promise<ResultatJournalAudit> {
  return requeterJournalAudit(filtres, 1, MAX_LIGNES_EXPORT_AUDIT)
}
