import { timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { archiverLuees, purgerArchivees } from '@/lib/notifications-dal'
import { estEnvoiConfigure } from '@/lib/notifications-envoi'
import {
  preparerResumesQuotidiens,
  traiterFileEmails,
  type BilanFile,
  type BilanResumes,
} from '@/lib/notifications-outbox'

// ─── GET /api/cron/notifications (M9, Vague 3) ──────────────────────────────
//
// POINT D'ENTRÉE UNIQUE des tâches planifiées du module, dans cet ordre :
//  1. `preparerResumesQuotidiens` — crée les lignes de digest du jour (une par
//     compte et par jour UTC, idempotent : les passages suivants n'ajoutent
//     rien) ;
//  2. `traiterFileEmails` — draine l'outbox (emails individuels ET digests),
//     par lots bornés, avec plafonds et reprises ;
//  3. `archiverLuees` — lit > 30 jours → archiveeLe (M9, Vague 1) ;
//  4. `purgerArchivees` — archiveeLe > 90 jours → suppression définitive.
//
// SÉCURITÉ : `CRON_SECRET` est OBLIGATOIRE. Sans secret configuré, la route
// répond 503 (elle ne devient jamais publique par accident) ; avec un secret,
// seul `Authorization: Bearer <secret>` passe (401 sinon), comparé en TEMPS
// CONSTANT. Aucune session : un planificateur externe n'a pas de cookie.
//
// OBSERVABILITÉ SANS PII : la réponse ne contient que des COMPTEURS et des
// CODES de tâche en échec (`resumes`, `file`, `archives`, `purges`) — jamais
// un identifiant de compte, une adresse, un sujet ou un corps d'erreur
// fournisseur. Un échec d'une tâche n'empêche pas les suivantes : le cron
// suivant rattrapera (toutes les tâches sont idempotentes).
//
// DÉPLOIEMENT : aucun planificateur n'est imposé par le dépôt (pas de
// vercel.json ni de cible Docker documentée). À appeler une fois par jour
// (par exemple 08:00 UTC) depuis le planificateur de l'hébergeur, avec
// l'en-tête ci-dessus. La route est dynamique et non cacheable.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Comparaison en temps constant de l'en-tête attendu. */
function secretValide(entete: string | null, secret: string): boolean {
  if (entete === null) return false
  const attendu = Buffer.from(`Bearer ${secret}`, 'utf8')
  const recu = Buffer.from(entete, 'utf8')
  return recu.length === attendu.length && timingSafeEqual(recu, attendu)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'cron_non_configure' }, { status: 503 })
  }
  if (!secretValide(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'non_autorise' }, { status: 401 })
  }

  const erreurs: string[] = []
  let resumes: BilanResumes = { candidats: 0, crees: 0 }
  let file: BilanFile = {
    configuration: estEnvoiConfigure() && Boolean(process.env.AUTH_SECRET?.trim()),
    examines: 0,
    envoyes: 0,
    reportes: 0,
    echecs: 0,
    abandons: 0,
  }
  let archives = 0
  let purges = 0

  try {
    resumes = await preparerResumesQuotidiens()
  } catch {
    erreurs.push('resumes')
  }

  try {
    file = await traiterFileEmails()
  } catch {
    erreurs.push('file')
  }

  try {
    archives = await archiverLuees()
  } catch {
    erreurs.push('archives')
  }

  try {
    purges = await purgerArchivees()
  } catch {
    erreurs.push('purges')
  }

  const reponse = NextResponse.json({
    ok: true,
    configuration: file.configuration,
    resumes,
    file,
    archives,
    purges,
    erreurs,
  })
  reponse.headers.set('Cache-Control', 'no-store, max-age=0')
  return reponse
}
