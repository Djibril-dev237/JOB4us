// ─── Modèles d'emails transactionnels (M9, NOTIFICATIONS) ───────────────────
//
// RÔLE : fabriquer le triple (sujet, texte brut, HTML) des 3 emails du
// module — notification simple, regroupement de messages, résumé quotidien.
// Ce module ne fait AUCUN envoi : l'envoi (Resend) appartient à la Vague 3,
// qui appellera UNIQUEMENT les 3 fonctions publiées ici.
//
// Contrats de style (validés Étapes 3 et 4) :
//  * SOURCE UNIQUE DES TEXTES = src/lib/notifications-labels.ts : aucune
//    phrase n'est écrite dans ce module (faille anti-vibecoding). Seuls des
//    séparateurs structurants (\n\n, ponctuation de liaison) sont locaux —
//    jamais une phrase, jamais la marque (importée depuis les labels).
//  * ÉCHAPPEMENT = ICI : la fabrique `texteNotification` recopie ses
//    variables (titre d'offre, acteur, statut…) TELLES QUELLES sans rien
//    échapper (documenté dans les labels) ; `echapperHtml` (privée, sans
//    dépendance) neutralise TOUTE donnée dans le rendu HTML. La version
//    texte reste du brut : jamais d'entité dans le texte.
//  * HTML « table-based » (aucun flex/grid), styles inline, largeur max
//    600px, lisible de 360 à 1280 px. Aucun dégradé, aucun
//    background-image, aucun tiret cadratin, aucune mention d'outil ni de
//    fabrication, aucune mention d'infogéreur.
//  * PIED DE PAGE : le lien de gestion des préférences ET le lien de
//    désabonnement, TOUJOURS présents — en `<a href>` dans le HTML, en URLs
//    brutes entre crochets dans le texte.
//
// Fonctions PURES : ni état global, ni réseau, ni base. Chaque email est un
// artefact autonome, testable sans rien d'autre que ses arguments.
// ---------------------------------------------------------------------------

import {
  NOM_APPLICATION,
  TEXTES,
  texteGroupeMessages,
  texteNotification,
  type VariablesNouveauMessage,
  type VariablesNotification,
} from '@/lib/notifications-labels'

/** URLs absolues déjà construites par l'appelant (Vague 3). */
export interface LiensEmail {
  /** Page de préférences de notification (pied de page + réactivation). */
  preferences: string
  /** Page de désabonnement, jeton personnel à durée limitée. */
  desabonnement: string
}

/** Artefact complet livré à l'appelant : les 3 formats d'un email. */
export interface EmailConstruit {
  /** Sujet en clair (aucun échappement : un sujet n'est jamais du HTML). */
  sujet: string
  /** Version texte brut, jamais échappée, URLs entre crochets. */
  texte: string
  /** Version HTML table-based, toute donnée échappée. */
  html: string
}

/**
 * Échappement d'entités HTML, sans dépendance. Ordre imposé : `&` d'abord
 * (sinon `&lt;` deviendrait `&amp;lt;`), puis les 4 autres caractères qui
 * peuvent fabriquer une balise ou casser un attribut guillemeté. Fonction
 * PRIVÉE : le rendu public est verrouillé par les tests du module.
 */
function echapperHtml(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Un paragraphe du corps : sous-tête facultative + contenu. */
interface BlocEmail {
  /** Sous-tête (grasse en HTML) ou `null` pour un simple paragraphe. */
  titre: string | null
  /** Donnée de contenu, recopiée telle quelle puis échappée en HTML. */
  contenu: string
}

// Styles inline, écrits une seule fois : aucune balise <style> ( filtrée par
// de nombreux clients email ), aucun framework. Polices système limitées.
const STYLE_TITRE_BLOC =
  'margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.4;font-weight:bold;color:#18181b;'
const STYLE_PARAGRAPHE =
  'margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#18181b;'
const STYLE_PIED =
  'margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#52525b;'

/** Version texte brut : titres, contenus, contexte, puis liens entre crochets. */
function composerTexte(blocs: readonly BlocEmail[], liens: LiensEmail): string {
  const paragraphes: string[] = []
  for (const bloc of blocs) {
    if (bloc.titre !== null) {
      paragraphes.push(bloc.titre)
    }
    paragraphes.push(bloc.contenu)
  }
  paragraphes.push(TEXTES.contexteEmail)
  paragraphes.push(`${TEXTES.lienGererPreferences} :\n[${liens.preferences}]`)
  paragraphes.push(`${TEXTES.lienDesabonner} :\n[${liens.desabonnement}]`)
  return paragraphes.join('\n\n')
}

/**
 * Version HTML : tables imbriquées (presentation), styles inline, largeur max
 * 600px, lisible de 360px à 1280px. Toute donnée passée par `blocs` et les
 * URLs de `liens` traversent `echapperHtml`.
 */
function composerHtml(
  sujet: string,
  blocs: readonly BlocEmail[],
  liens: LiensEmail,
): string {
  const corps = blocs
    .map((bloc) => {
      const titre =
        bloc.titre === null
          ? ''
          : `<p style="${STYLE_TITRE_BLOC}">${echapperHtml(bloc.titre)}</p>`
      return `${titre}<p style="${STYLE_PARAGRAPHE}">${echapperHtml(bloc.contenu)}</p>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapperHtml(sujet)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#f4f4f5;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e4e4e7;">
<tr>
<td style="padding:32px 24px;">
${corps}
</td>
</tr>
<tr>
<td style="padding:24px;border-top:1px solid #e4e4e7;">
<p style="${STYLE_PIED}">${echapperHtml(TEXTES.contexteEmail)}</p>
<p style="${STYLE_PIED}"><a href="${echapperHtml(liens.preferences)}" style="color:#2563eb;">${echapperHtml(TEXTES.lienGererPreferences)}</a></p>
<p style="${STYLE_PIED}"><a href="${echapperHtml(liens.desabonnement)}" style="color:#2563eb;">${echapperHtml(TEXTES.lienDesabonner)}</a></p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}

/** Assemblage commun des 3 emails : même corps, même pied de page. */
function composerEmail(
  sujet: string,
  blocs: readonly BlocEmail[],
  liens: LiensEmail,
): EmailConstruit {
  return {
    sujet,
    texte: composerTexte(blocs, liens),
    html: composerHtml(sujet, blocs, liens),
  }
}

/**
 * Email d'une notification simple : titre et contenu viennent de la fabrique
 * `texteNotification` (source unique), le sujet est le titre préfixé par
 * l'application.
 */
export function construireEmailNotification(
  variables: VariablesNotification,
  liens: LiensEmail,
): EmailConstruit {
  const { titre, contenu } = texteNotification(variables)
  return composerEmail(`${NOM_APPLICATION} : ${titre}`, [{ titre, contenu }], liens)
}

/**
 * Email de regroupement des messages d'une conversation : le sujet est porté
 * par `texteNotification` (type nouveauMessage, avec le nom de l'acteur), le
 * nombre de messages regroupés est porté par `texteGroupeMessages` en tête
 * du corps. Le compteur reçu ici fait foi (il peut différer de celui embarqué
 * dans `variablesActeur` : c'est le compteur du lot que l'on envoie).
 */
export function construireEmailGroupeMessages(
  compteur: number,
  variablesActeur: { type: 'nouveauMessage' } & VariablesNouveauMessage,
  liens: LiensEmail,
): EmailConstruit {
  const { titre, contenu } = texteNotification(variablesActeur)
  return composerEmail(
    `${NOM_APPLICATION} : ${titre}`,
    [{ titre: texteGroupeMessages(compteur), contenu }],
    liens,
  )
}

/**
 * Email de résumé quotidien (digest) : sujet et phrase d'introduction viens
 * de `TEXTES`, chaque ligne est un bloc (sous-tête + contenu) échappé en
 * HTML ; une liste vide affiche l'état vide des labels.
 */
export function construireEmailResumeQuotidien(
  lignes: { titre: string; contenu: string }[],
  liens: LiensEmail,
): EmailConstruit {
  const blocsLignes: BlocEmail[] =
    lignes.length === 0
      ? [{ titre: null, contenu: TEXTES.resumeAucuneNouveaute }]
      : lignes.map((ligne) => ({ titre: ligne.titre, contenu: ligne.contenu }))
  const blocs: BlocEmail[] = [
    { titre: null, contenu: TEXTES.corpsEmailResume },
    ...blocsLignes,
  ]
  return composerEmail(TEXTES.sujetEmailResume, blocs, liens)
}
