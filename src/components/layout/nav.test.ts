import { describe, expect, it } from 'vitest'

import { NAV_SECONDARY, PUBLIC_NAV, SIDEBAR_NAV } from './nav'

// ─── Décision de confidentialité — annuaire candidats (M3-ST10) ───────────────
// L'annuaire recruteur legacy (/recruteur/candidats, contrôleur
// CandidatSearchController) listait TOUS les profils candidats avec moteur de
// recherche — supprimé par décision de la matrice Étape 2 (jamais construit).
// Ce test verrouille la décision : toute réintroduction d'un lien d'annuaire
// dans la navigation (header, sidebar, menu mobile, menu profil, footer du
// shell) casse la grille. Un recruteur n'accède aux CV que via ses propres
// offres (matrice M4), jamais via une base de profils consultable.
// ---------------------------------------------------------------------------

const ROLES = ['candidat', 'recruteur', 'admin'] as const

/** Tous les hrefs exposés par la navigation connectée et publique. */
const TOUS_LES_HREFS: string[] = [
  ...PUBLIC_NAV.map((item) => item.href),
  ...ROLES.flatMap((role) => [
    ...NAV_SECONDARY[role].map((item) => item.href),
    ...SIDEBAR_NAV[role].flatMap((section) =>
      section.items.map((item) => item.href),
    ),
  ]),
]

describe('confidentialité — annuaire candidats retiré (M3-ST10)', () => {
  it("aucune entrée de navigation ne pointe vers /recruteur/candidats", () => {
    expect(TOUS_LES_HREFS).not.toContain('/recruteur/candidats')
  })

  it("aucun chemin du type /candidats (annuaire, sous-page) n'est exposé", () => {
    expect(TOUS_LES_HREFS.filter((href) => href.includes('/candidats'))).toEqual(
      [],
    )
  })

  it('la navigation recruteur reste exploitable sans l’annuaire', () => {
    const hrefsRecruteur = SIDEBAR_NAV.recruteur.flatMap((section) =>
      section.items.map((item) => item.href),
    )
    // Les pages réellement livrées/migrées restent atteignables.
    expect(hrefsRecruteur).toContain('/recruteur/dashboard')
    expect(hrefsRecruteur).toContain('/recruteur/entreprise')
    // Les modules à venir (offres, candidatures) restent déclarés — seules
    // les pages de listes de PROFILS sont bannies.
    expect(hrefsRecruteur).toContain('/recruteur/offres')
  })
})

// ─── Accès aux offres publiques (M5) ─────────────────────────────────────────
// La liste /offres (M5, task 2b) doit rester joignable depuis le chrome du
// site : le visiteur découvre les offres par le header public, sans passer
// par une URL connue d'avance. Verrouillé ici pour qu'une régression de
// navigation ne rende pas le module inaccessible.

describe('accès aux offres publiques (M5)', () => {
  it("le lien « Offres d'emploi » figure dans la navigation publique", () => {
    expect(PUBLIC_NAV).toContainEqual({
      label: "Offres d'emploi",
      href: '/offres',
    })
  })
})
