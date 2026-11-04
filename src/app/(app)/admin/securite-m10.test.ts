import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// ─── Grille de sécurité M10 (statique et contractuelle) ─────────────────────
// Les tests d'actions vérifient le comportement ; cette grille verrouille la
// COUVERTURE : chaque page/route admin et chaque action admin doit appeler
// `requireAdmin()` en premier. Une nouvelle page admin sans garde casse ici
// avant même d'être déployée. Les triggers SQL append-only sont aussi lus pour
// empêcher la réintroduction d'un UPDATE/DELETE sur les traces.
// ---------------------------------------------------------------------------

const RACINE = process.cwd()

function fichiersSous(dossier: string): string[] {
  const resultat: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) resultat.push(...fichiersSous(chemin))
    else resultat.push(chemin)
  }
  return resultat
}

function lire(chemin: string): string {
  return readFileSync(join(RACINE, chemin), 'utf8')
}

function corpsFonction(source: string, nom: string): string {
  const debut = source.indexOf(`export async function ${nom}`)
  expect(debut, `fonction ${nom} introuvable`).toBeGreaterThanOrEqual(0)
  const fin = source.indexOf('\nexport ', debut + 1)
  return source.slice(debut, fin === -1 ? undefined : fin)
}

describe('couverture des gardes admin', () => {
  it('chaque page et route handler sous /admin appelle requireAdmin', () => {
    const dossierAdmin = join(RACINE, 'src/app/(app)/admin')
    const fichiers = fichiersSous(dossierAdmin).filter(
      (chemin) =>
        chemin.endsWith('page.tsx') || chemin.endsWith('route.ts'),
    )

    expect(fichiers.length).toBeGreaterThanOrEqual(8)
    for (const chemin of fichiers) {
      const source = readFileSync(chemin, 'utf8')
      const nom = relative(RACINE, chemin).replaceAll('\\', '/')
      expect(source, `${nom} doit appeler requireAdmin()`).toMatch(
        /await requireAdmin\(\)/,
      )
      expect(source, `${nom} ne doit pas utiliser verifyRole`).not.toMatch(
        /verifyRole\s*\(/,
      )
    }
  })

  it('chaque action admin commence par requireAdmin', () => {
    const actions: Record<string, string[]> = {
      'src/app/actions/admin-messagerie.ts': [
        'ouvrirConversationSignalement',
        'deciderSignalement',
        'retablirMessage',
      ],
      'src/app/actions/admin-utilisateurs.ts': [
        'suspendreUtilisateur',
        'reactiverUtilisateur',
      ],
      'src/app/actions/offres-admin.ts': ['suspendreOffre', 'releverOffre'],
      'src/app/actions/admin-auth.ts': ['reauthentifierAdmin'],
    }

    for (const [fichier, fonctions] of Object.entries(actions)) {
      const source = lire(fichier)
      for (const fonction of fonctions) {
        const corps = corpsFonction(source, fonction)
        const positionGarde = corps.indexOf('await requireAdmin()')
        const positionPremiereLecture = corps.indexOf('prisma.')
        expect(positionGarde, `${fonction} doit appeler requireAdmin()`).toBeGreaterThanOrEqual(
          0,
        )
        if (positionPremiereLecture >= 0) {
          expect(positionGarde, `${fonction} garde avant la première lecture`).toBeLessThan(
            positionPremiereLecture,
          )
        }
      }
    }
  })

  it("l'export d'audit exige un grant de reauthentification", () => {
    const source = lire('src/app/(app)/admin/audit/export/route.ts')
    expect(source).toMatch(/reauthAdminValide\(session\.userId\)/)
    expect(source).toMatch(/NextResponse\.redirect/)
  })

  it('les traces sont append-only par trigger SQL', () => {
    const sql = lire(
      'prisma/migrations/20261028100001_m10_journal_audit_vue/migration.sql',
    )

    for (const table of [
      'journal_audit',
      'message_moderation',
      'audit_candidatures',
      'audit_conversations',
      'acces_fichiers',
    ]) {
      expect(sql).toMatch(
        new RegExp(`BEFORE UPDATE ON \\\`${table}\\\``),
      )
      expect(sql).toMatch(
        new RegExp(`BEFORE DELETE ON \\\`${table}\\\``),
      )
      expect(sql).toMatch(/SIGNAL SQLSTATE '45000'/)
    }
  })
})
