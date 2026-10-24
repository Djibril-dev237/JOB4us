import { describe, expect, it } from 'vitest'

import {
  NOM_APPLICATION,
  TEXTES,
  texteGroupeMessages,
  texteNotification,
} from './notifications-labels'
import {
  construireEmailGroupeMessages,
  construireEmailNotification,
  construireEmailNotificationRendue,
  construireEmailResumeQuotidien,
  type LiensEmail,
} from './notifications-emails'

// ─── Contrats des modèles d'emails transactionnels (M9, Vague 3) ────────────
// Verrouillent ce que la Vague 3 enverra via Resend : chaque fonction produit
// un sujet, un texte et un HTML non vides ; le HTML est table-based 600px ;
// les deux liens du pied de page (préférences + désabonnement) sont présents
// en `<a href>` ET en texte brut ; TOUTE donnée venue des variables est
// échappée en HTML (les labels ne l'échappent pas, c'est documenté) ; le
// digest vide bascule sur l'état vide des labels ; aucune émogrène ni
// mention d'outil/fabrication dans aucun artefact.
// ---------------------------------------------------------------------------

const LIENS: LiensEmail = {
  preferences: 'https://job4us.example/notifications/preferences',
  desabonnement: 'https://job4us.example/desabonnement/abc123',
}

const VARIABLES_MESAGE = {
  type: 'nouveauMessage',
  acteur: 'Marie Dupont',
  compteur: 1,
} as const

/** Les 3 emails types, bouclés par les tests transverses. */
function emailsATester(): { nom: string; email: ReturnType<typeof construireEmailNotification> }[] {
  return [
    {
      nom: 'notification simple',
      email: construireEmailNotification(
        { type: 'candidatureRecue', titreOffre: 'Développeur' },
        LIENS,
      ),
    },
    {
      nom: 'regroupement de messages',
      email: construireEmailGroupeMessages(3, VARIABLES_MESAGE, LIENS),
    },
    {
      nom: 'résumé quotidien',
      email: construireEmailResumeQuotidien(
        [{ titre: 'Nouvelle candidature', contenu: 'Un candidat a postulé.' }],
        LIENS,
      ),
    },
    {
      nom: 'résumé quotidien vide',
      email: construireEmailResumeQuotidien([], LIENS),
    },
  ]
}

describe('construireEmailNotification (notification simple)', () => {
  it('produit un sujet, un texte et un HTML non vides', () => {
    const email = construireEmailNotification(
      { type: 'offreIndisponible', titreOffre: 'Développeur' },
      LIENS,
    )
    expect(email.sujet.length).toBeGreaterThan(0)
    expect(email.texte.length).toBeGreaterThan(0)
    expect(email.html.length).toBeGreaterThan(0)
  })

  it('le sujet porte le titre de la fabrique et le nom de l’application', () => {
    const variables = { type: 'candidatureRecue', titreOffre: 'Développeur' } as const
    const { titre } = texteNotification(variables)
    const email = construireEmailNotification(variables, LIENS)
    expect(email.sujet).toBe(`${NOM_APPLICATION} : ${titre}`)
    expect(email.texte).toContain(titre)
    expect(email.html).toContain(titre)
  })

  it('chaque type du catalogue produit les 3 formats non vides', () => {
    const productions = [
      { type: 'candidatureRecue', titreOffre: 'Développeur' },
      { type: 'statutCandidature', titreOffre: 'Développeur', libelleStatut: 'Acceptée' },
      { type: 'candidatureRetiree', titreOffre: 'Développeur' },
      { type: 'offreIndisponible', titreOffre: 'Développeur' },
      { type: 'signalementRecu' },
      { type: 'offrePubliee', titreOffre: 'Développeur' },
      { type: 'entrepriseCertifiee', nomEntreprise: 'ACME' },
      { type: 'systeme', acteur: 'Marie Dupont', role: 'candidat' },
    ] as const
    for (const variables of productions) {
      const email = construireEmailNotification(variables, LIENS)
      expect(email.sujet.length, variables.type).toBeGreaterThan(0)
      expect(email.texte.length, variables.type).toBeGreaterThan(0)
      expect(email.html.length, variables.type).toBeGreaterThan(0)
    }
  })
})

describe('construireEmailGroupeMessages (regroupement)', () => {
  it('produit un sujet, un texte et un HTML non vides', () => {
    const email = construireEmailGroupeMessages(3, VARIABLES_MESAGE, LIENS)
    expect(email.sujet.length).toBeGreaterThan(0)
    expect(email.texte.length).toBeGreaterThan(0)
    expect(email.html.length).toBeGreaterThan(0)
  })

  it('contient le libellé de regroupement produit par texteGroupeMessages', () => {
    const email = construireEmailGroupeMessages(3, VARIABLES_MESAGE, LIENS)
    const libelle = texteGroupeMessages(3)
    expect(libelle).toBe('3 nouveaux messages')
    expect(email.texte).toContain(libelle)
    expect(email.html).toContain(libelle)
  })

  it('le sujet reste porté par texteNotification (type nouveauMessage)', () => {
    const { titre } = texteNotification(VARIABLES_MESAGE)
    const email = construireEmailGroupeMessages(1, VARIABLES_MESAGE, LIENS)
    expect(email.sujet).toBe(`${NOM_APPLICATION} : ${titre}`)
    expect(email.texte).toContain(texteGroupeMessages(1))
  })
})

describe('construireEmailResumeQuotidien (digest)', () => {
  it('produit un sujet, un texte et un HTML non vides', () => {
    const email = construireEmailResumeQuotidien(
      [{ titre: 'Offre publiée', contenu: 'Une offre a été publiée.' }],
      LIENS,
    )
    expect(email.sujet.length).toBeGreaterThan(0)
    expect(email.texte.length).toBeGreaterThan(0)
    expect(email.html.length).toBeGreaterThan(0)
  })

  it('le sujet et l’introduction viennent de TEXTES', () => {
    const email = construireEmailResumeQuotidien(
      [{ titre: 'Offre publiée', contenu: 'Une offre a été publiée.' }],
      LIENS,
    )
    expect(email.sujet).toBe(TEXTES.sujetEmailResume)
    expect(email.texte).toContain(TEXTES.corpsEmailResume)
    expect(email.html).toContain(TEXTES.corpsEmailResume)
  })

  it('digest vide : utilise TEXTES.resumeAucuneNouveaute dans les 3 formats', () => {
    const email = construireEmailResumeQuotidien([], LIENS)
    expect(email.texte).toContain(TEXTES.resumeAucuneNouveaute)
    expect(email.html).toContain(TEXTES.resumeAucuneNouveaute)
  })

  it('digest non vide : chaque titre et contenu apparaissent, échappés en HTML', () => {
    const email = construireEmailResumeQuotidien(
      [
        { titre: 'Nouvelle candidature <b>1</b>', contenu: 'Un candidat a postulé.' },
        { titre: 'Statut de candidature', contenu: 'Statut passé à Acceptée.' },
      ],
      LIENS,
    )
    // Le texte reste brut (jamais d’entité).
    expect(email.texte).toContain('Nouvelle candidature <b>1</b>')
    // Le HTML échappe chaque donnée recopiée par les labels.
    expect(email.html).toContain('Nouvelle candidature &lt;b&gt;1&lt;/b&gt;')
    expect(email.html).not.toContain('Nouvelle candidature <b>1</b>')
    expect(email.texte).toContain('Statut de candidature')
    expect(email.html).toContain('Statut de candidature')
    expect(email.texte).toContain('Statut passé à Acceptée.')
  })
})

describe('pied de page commun (préférences + désabonnement)', () => {
  it('les deux liens apparaissent en <a href> dans le HTML ET en texte brut', () => {
    for (const { nom, email } of emailsATester()) {
      expect(email.html, nom).toContain(`<a href="${LIENS.preferences}"`)
      expect(email.html, nom).toContain(`<a href="${LIENS.desabonnement}"`)
      expect(email.texte, nom).toContain(`[${LIENS.preferences}]`)
      expect(email.texte, nom).toContain(`[${LIENS.desabonnement}]`)
      // Les libellés du pied de page viennent des labels, pas d’une phrase locale.
      expect(email.texte, nom).toContain(TEXTES.lienGererPreferences)
      expect(email.texte, nom).toContain(TEXTES.lienDesabonner)
      expect(email.html, nom).toContain(TEXTES.lienGererPreferences)
      expect(email.html, nom).toContain(TEXTES.lienDesabonner)
      expect(email.texte, nom).toContain(TEXTES.contexteEmail)
      expect(email.html, nom).toContain(TEXTES.contexteEmail)
    }
  })
})

describe('HTML table-based 600px (contrat de rendu email)', () => {
  it('chaque email contient des <table> et une largeur maximale de 600px', () => {
    for (const { nom, email } of emailsATester()) {
      expect(email.html, nom).toContain('<table')
      expect(email.html, nom).toContain('</table>')
      expect(email.html, nom).toContain('600')
      expect(email.html, nom).toContain('max-width:600px')
      // Aucun flexbox ni grid : structure 100 % tables.
      expect(email.html, nom).not.toContain('display:flex')
      expect(email.html, nom).not.toContain('display:grid')
    }
  })
})

describe('échappement HTML des variables (neutralisation XSS)', () => {
  it('un titre d’offre injecté est échappé en HTML, brut dans le texte', () => {
    const variables = {
      type: 'candidatureRecue',
      titreOffre: '<script>alert(1)</script>',
    } as const
    const email = construireEmailNotification(variables, LIENS)
    // Le HTML neutralise les balises : entités, jamais d’octet de balise.
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(email.html).not.toContain('<script>alert(1)')
    // Le texte reste brut (règle : texte brut jamais échappé).
    expect(email.texte).toContain('<script>alert(1)</script>')
  })

  it('les apostrophes et guillemets des variables sont échappés en HTML', () => {
    const email = construireEmailNotification(
      { type: 'entrepriseCertifiee', nomEntreprise: `ACME & "Fils" <it>'` },
      LIENS,
    )
    expect(email.html).toContain('ACME &amp; &quot;Fils&quot; &lt;it&gt;&#39;')
    expect(email.texte).toContain(`ACME & "Fils" <it>'`)
  })

  it('un acteur injecté dans le regroupement est échappé en HTML', () => {
    const email = construireEmailGroupeMessages(
      3,
      { type: 'nouveauMessage', acteur: '<img src=x onerror=alert(1)>', compteur: 3 },
      LIENS,
    )
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(email.html).not.toContain('<img src=x')
    expect(email.texte).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('règles de design (émogrène, mentions d’outil)', () => {
  it('aucun tiret cadratin, aucune mention d’outil ni de fabrication', () => {
    const interdits = ['—', '–', 'AI', 'made with', 'Generated', 'GPT']
    for (const { nom, email } of emailsATester()) {
      for (const interdit of interdits) {
        expect(email.texte, `${nom} / texte / ${interdit}`).not.toContain(interdit)
        expect(email.html, `${nom} / html / ${interdit}`).not.toContain(interdit)
      }
    }
  })
})

describe('construireEmailNotificationRendue (envoi différé de l’outbox)', () => {
  it('équivaut EXACTEMENT à construireEmailNotification pour une notification simple', () => {
    const variables = { type: 'candidatureRecue', titreOffre: 'Développeur' } as const
    const { titre, contenu } = texteNotification(variables)
    const attendu = construireEmailNotification(variables, LIENS)
    const rendu = construireEmailNotificationRendue(
      { type: 'candidatureRecue', titre, contenu, compteur: 1 },
      LIENS,
    )
    expect(rendu).toEqual(attendu)
  })

  it('équivaut EXACTEMENT à construireEmailGroupeMessages pour un message regroupé', () => {
    const variables = { type: 'nouveauMessage', acteur: 'Marie Dupont', compteur: 3 } as const
    const { titre, contenu } = texteNotification(variables)
    const attendu = construireEmailGroupeMessages(3, variables, LIENS)
    const rendu = construireEmailNotificationRendue(
      { type: 'nouveauMessage', titre, contenu, compteur: 3 },
      LIENS,
    )
    expect(rendu).toEqual(attendu)
  })

  it('un compteur > 1 hors messagerie garde le titre de la notification', () => {
    const variables = { type: 'candidatureRetiree', titreOffre: 'Développeur' } as const
    const { titre, contenu } = texteNotification(variables)
    const rendu = construireEmailNotificationRendue(
      { type: 'candidatureRetiree', titre, contenu, compteur: 2 },
      LIENS,
    )
    expect(rendu.texte).toContain(titre)
    expect(rendu.texte).not.toContain(texteGroupeMessages(2))
  })

  it('un contenu nul (colonne String?) devient vide, sans jeter', () => {
    const rendu = construireEmailNotificationRendue(
      { type: 'signalementRecu', titre: 'Signalement reçu', contenu: null, compteur: 1 },
      LIENS,
    )
    expect(rendu.sujet).toBe(`${NOM_APPLICATION} : Signalement reçu`)
    expect(rendu.texte.length).toBeGreaterThan(0)
    expect(rendu.html.length).toBeGreaterThan(0)
  })

  it('le contenu stocké est toujours échappé en HTML (défense XSS)', () => {
    const rendu = construireEmailNotificationRendue(
      {
        type: 'candidatureRecue',
        titre: 'Nouvelle candidature',
        contenu: '<img src=x onerror=alert(1)>',
        compteur: 1,
      },
      LIENS,
    )
    expect(rendu.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(rendu.html).not.toContain('<img src=x')
  })
})
