import { lireFiltresAudit } from '@/lib/audit-url'
import { construireCsvAudit } from '@/lib/csv-audit'
import { requireAdmin } from '@/lib/dal'
import { consignerAudit, lireJournalAuditPourExport } from '@/lib/journal-audit'
import { prisma } from '@/lib/prisma'

// ─── Export CSV du journal d'audit — /admin/audit/export (M10) ───────────────
// Route serveur, jamais un Server Action : le navigateur reçoit un fichier.
// `requireAdmin()` précède toute lecture ; les filtres sont les mêmes que la
// page, validés par catalogue fermé. L'export lui-même est une action sensible
// tracée AVANT l'envoi du fichier. Le plafond de 5000 lignes est signalé par
// l'en-tête `X-Export-Truncated`, sans jamais inventer de lignes manquantes.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdmin()

  const url = new URL(request.url)
  const { filtres } = lireFiltresAudit(url.searchParams)
  const resultat = await lireJournalAuditPourExport(filtres)

  await consignerAudit(prisma, {
    acteurId: session.userId,
    action: 'export_audit',
    cibleType: 'systeme',
    commentaire: `Export CSV du journal d'audit (${resultat.lignes.length} ligne(s) sur ${resultat.total}).`,
  })

  const csv = construireCsvAudit(resultat.lignes)
  const nomFichier = `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomFichier}"`,
      'Cache-Control': 'no-store',
      'X-Export-Truncated': resultat.total > resultat.lignes.length ? 'true' : 'false',
    },
  })
}
