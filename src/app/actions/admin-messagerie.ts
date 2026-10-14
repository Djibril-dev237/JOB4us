'use server'

import { Prisma } from '@prisma/client'

import { verifySession } from '@/lib/dal'
import { nettoyerMotif } from '@/lib/messagerie-contenu'
import { schemaTraiterSignalement } from '@/lib/messagerie-schemas'
import { prisma } from '@/lib/prisma'

// ─── Actions serveur de MODÉRATION admin (M8, Vague 3) ───────────────────────
//
// Contrats repris AU MOT de src/app/actions/messagerie.ts (Vague 2) :
//
// * SESSION : `verifySession` (miroir M7/M8), puis garde de RÔLE admin ICI —
//   l'admin n'a pas accès au canal privé de messagerie, mais c'est lui qui
//   traite la file de modération. Un rôle non-admin reçoit la panne
//   GÉNÉRIQUE (`inconnue`), jamais un verdict qui révélerait l'existence
//   d'un espace de modération. Un non-connecté garde le redirect /login du
//   DAL (comportement commun à toutes les actions du dépôt).
//
// * ORDRE DE CONTRÔLE (chaque échec précoce = zéro effet de bord) :
//     1) session + rôle admin          → `inconnue`
//     2) forme du payload (Zod .strict()) → `inconnue`
//     3) nettoyage de la note (`nettoyerMotif`) → note vide = `null` stockée
//     4) écriture compare-and-set, puis décompte → succès / déjà / `inconnue`
//     5) catch ciblé : log SANS donnée personnelle, verdict `inconnue`
//
// * `null` NOTE = note ABSENTE : le schema n'accepte que `string | undefined`
//   (`.strict()`), le contrat JS du payload admet `null` — la conversion se
//   fait AVANT le parse, jamais après (un `null` post-parse contournerait la
//   validation).
//
// * CLÔTURE PAR COMPARE-AND-SET : `updateMany({ where: { id, statut:
//   'ouvert' } })` n'attrape la ligne QUE si elle est encore ouverte — deux
//   admins qui clôturent le même signalement ne peuvent pas écraser la note
//   l'un de l'autre (pas de transaction, pas de verrou : le décompte Suffit).
//   `count === 0` est ensuite DÉCOMPOSÉ (signalement existant = idempotent,
//   signalement absent = panne générique) : aucune clé d'erreur distincte à
//   mémoriser côté client.
//
// * JAMAIS d'exception brute ne sort de l'action : `traiterSignalement`
//   renvoie `inconnue`. Aucun seau, aucun hook d'événement (M9 n'a pas
//   d'événement de modération, et le journal d'accès est porté par la PAGE
//   de détail : AuditConversation).
// ---------------------------------------------------------------------------

/** Verdict d'une clôture : `deja` = le signalement n'était plus ouvert. */
export type ResultatTraitement =
  | { ok: true; deja: boolean }
  | { ok: false; erreur: 'inconnue' }

/**
 * Clôture un signalement (modération admin) avec note interne optionnelle.
 *
 * @param payload identifiant du signalement + note (nullable) — l'ACTEUR
 *        (`traiteParId`) sort de la session, jamais du payload (liste
 *        blanche M7/M8, reconduite).
 */
export async function traiterSignalement(payload: {
  signalementId: number
  noteInterne: string | null
}): Promise<ResultatTraitement> {
  // 1) Session + rôle admin : un non-admin reçoit la panne générique, et le
  //    reste de l'action n'est même pas interrogé (zéro lecture, zéro
  //    écriture — cf. les tests).
  const session = await verifySession()
  if (session.role !== 'admin') {
    return { ok: false, erreur: 'inconnue' }
  }

  // 2) Forme du payload : `null` = note absente (contrat JS) → `undefined`
  //    pour le schema. La normalisation part d'un objet NEUTRE et ne
  //    déréférence JAMAIS le payload d'origine : un appel forgé
  //    `traiterSignalement(null)` lèverait une TypeError HORS try/catch
  //    (500) si l'on lisait `payload.noteInterne` ici. Le spread conserve
  //    les clés inconnues d'un appel forgé, que `.strict()` rejette.
  const brut: Partial<{ signalementId: number; noteInterne: string | null }> =
    payload ?? {}
  const parse = schemaTraiterSignalement.safeParse({
    ...brut,
    noteInterne: brut.noteInterne ?? undefined,
  })
  if (!parse.success) {
    return { ok: false, erreur: 'inconnue' }
  }

  // 3) Nettoyage de la note (même pipeline que le motif de signalement) :
  //    une note réduite à du blanc n'est pas une note → `null` stockée.
  let notePropre: string | null = null
  if (parse.data.noteInterne !== undefined) {
    const nettoyee = nettoyerMotif(parse.data.noteInterne)
    notePropre = nettoyee === '' ? null : nettoyee
  }

  try {
    // 4) Compare-and-set : la clause `statut: 'ouvert'` fait que seules les
    //    lignes ENCORE ouvertes bougent — le décompte décide du verdict.
    const miseAJour = await prisma.signalement.updateMany({
      where: { id: parse.data.signalementId, statut: 'ouvert' },
      data: {
        statut: 'traite',
        traiteParId: session.userId,
        traiteLe: new Date(),
        noteInterne: notePropre,
      },
    })
    if (miseAJour.count === 1) {
      return { ok: true, deja: false }
    }

    // Décompte 0 : signalement déjà clôturé par un autre admin (idempotent,
    // AUCUNE seconde écriture) ou signalement inexistant. La lecture ne
    // porte QUE l'id : rien d'autre n'est nécessaire au verdict.
    const signalement = await prisma.signalement.findFirst({
      where: { id: parse.data.signalementId },
      select: { id: true },
    })
    if (signalement !== null) {
      return { ok: true, deja: true }
    }
    return { ok: false, erreur: 'inconnue' }
  } catch (erreur) {
    // 5) Erreur DB inattendue (panne, FK, timeout) : le code Prisma est utile
    //    au diagnostic, la NOTE et l'identité ne le sont JAMAIS — on ne
    //    journalise ni note, ni nom, ni email. `erreur.code` n'existe que
    //    sur les erreurs connues Prisma : ailleurs, un libellé neutre.
    const code = erreur instanceof Prisma.PrismaClientKnownRequestError ? erreur.code : 'INCONNU'
    console.error('[admin-messagerie] cloture', { signalementId: parse.data.signalementId, code })
    return { ok: false, erreur: 'inconnue' }
  }
}
