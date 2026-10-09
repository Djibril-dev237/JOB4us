import 'server-only'

import { validateUpload, type ValidationResult } from '@/lib/files'
import { prisma } from '@/lib/prisma'
import {
  copyPrivateObject,
  deleteObject,
  downloadMeta,
  generateKey,
  putPrivateObject,
} from '@/lib/storage'

// ─── Pièce jointe FIGÉE : snapshot du CV par candidature (M7) ─────────────────
// Diagnostic étape 1 #4 (gravité HAUTE) : le legacy range dans
// `candidatures.cv_path` une simple CHAÎNE partagée avec le CV de profil
// (`cvs/…`). Supprimer le CV de profil (ProfilController.php:93-94) supprime
// l'objet physique : le recruteur qui rouvre la candidature reçoit un 404.
// Cela violerait le critère M7 — « le CV rattaché à une candidature reste
// accessible au recruteur même si le candidat modifie son profil ».
//
// Décision étape 2 validée : COPIE PHYSIQUE RÉELLE. À la postulation, un
// NOUVEL objet R2 est créé sous `candidatures/<uuid>.*` et
// `Candidature.cvPath` pointe vers CE fichier. Remplacer ou supprimer le CV
// de profil ne peut plus l'atteindre : deux clés, deux objets indépendants —
// le snapshot survit à toute évolution du profil.
//
// Sécurité (doctrine du module) :
// - la CLÉ CIBLE est TOUJOURS générée par le serveur (generateKey →
//   `candidatures/<uuid>.<ext>`), jamais dérivée d'un identifiant, jamais
//   reçue du client, jamais le nom d'origine du fichier ;
// - `candidatId` est déduit de la SESSION par l'appelant, jamais du payload :
//   la source « profil » lit le champ du profil DE CE candidat — aucune clé
//   d'origine n'est acceptable de l'extérieur ;
// - la validation (présence, 5 Mo, type RÉEL lu dans les octets de tête,
//   SVG refusé) est celle de files.ts, réutilisée par import — JAMAIS
//   recopiée ici (mimes, taille, signatures binaires) ;
// - aucune écriture avant validation complète, aucun log, aucun upload.
//
// Contrat d'appel (l'action transactionnelle de la V2 l'appliquera) :
// - JAMAIS d'exception pour un cas documenté : le retour est une union
//   façon ValidationResult de files.ts ;
// - une clé n'est retournée QUE sur `ok: true` ; si l'écriture base
//   suivante (création de la Candidature) échoue, l'appelant DOIT appeler
//   `annulerSnapshotCv(cle)` — rollback best-effort de l'objet orphelin ;
// - sur `ok: false`, AUCUNE clé n'est retournée : rien à annuler (une
//   opération R2 refusée n'écrit rien ; un objet éventuellement présent
//   mais non référencé reste dans le bucket privé, inatteignable sans clé).
// ---------------------------------------------------------------------------

/** Choix du candidat (radio du formulaire de postulation). */
export type SourceCv = 'profil' | 'fichier'

/** Résultat union calqué sur ValidationResult de files.ts — JAMAIS d'exception non gérée. */
export type ResultatSnapshotCv =
  | { ok: true; cle: string }
  | { ok: false; code: 'profil-incomplet' | 'fichier-invalide' | 'echec-stockage' }

/**
 * Préfixe des snapshots — le miroir exact du préfixe `'candidatures'` de
 * `generateKey` (storage.ts), doublé d'un `/` : sert de garde de suppression
 * à `annulerSnapshotCv`.
 */
const PREFIXE_SNAPSHOT = 'candidatures/'

/**
 * Prépare le snapshot CV d'une candidature et renvoie la CLÉ R2 à stocker
 * dans `Candidature.cvPath`.
 *
 * La clé cible est TOUJOURS générée par le serveur (generateKey →
 * `candidatures/<uuid>`), JAMAIS dérivée d'un identifiant ni reçue du client.
 *
 * - `source === 'profil'` : lecture de `Candidat.cvPath` pour le `candidatId`
 *   de la session, puis copie PHYSIQUE vers une clé neuve (`downloadMeta`
 *   fournit extension + contentType depuis la clé source). `cvPath` absent →
 *   `profil-incomplet`, aucune écriture. Échec R2 → `echec-stockage`.
 * - `source === 'fichier'` : `validateUpload` (files.ts) contrôle présence,
 *   taille et signature binaire AVANT toute écriture ; refus →
 *   `fichier-invalide`. Échec R2 → `echec-stockage`.
 *
 * **Contrat de nettoyage** : toute clé retournée (`ok: true`) devient la
 * responsabilité de l'appelant — si la transaction d'écriture qui la
 * persiste échoue, celui-ci appelle `annulerSnapshotCv(cle)`. Ce module ne
 * transige jamais avec la base.
 */
export async function preparerSnapshotCv(params: {
  /** Déduit de la SESSION par l'appelant, jamais du payload. */
  candidatId: number
  source: SourceCv
  /** Fourni UNIQUEMENT si `source === 'fichier'`. */
  fichier?: File
}): Promise<ResultatSnapshotCv> {
  const { candidatId, source, fichier } = params

  if (source === 'profil') {
    try {
      // Source de vérité = le champ du PROFIL du candidat identifié par la
      // session : aucune clé n'est acceptée de l'extérieur.
      const candidat = await prisma.candidat.findUnique({
        where: { id: candidatId },
        select: { cvPath: true },
      })
      const cleSource = candidat?.cvPath
      if (!cleSource) {
        // Candidat sans CV (ou profil absent) : aucune écriture.
        return { ok: false, code: 'profil-incomplet' }
      }
      // Extension + MIME déduits DE LA CLÉ source (pas de nom déclaré),
      // clé cible neuve servie par le serveur, puis copie physique dans le
      // même bucket privé (en-têtes de sécurité ré-imposés en REPLACE).
      const meta = downloadMeta(cleSource, 'pdf')
      const cle = generateKey('candidatures', meta.extension)
      await copyPrivateObject(cleSource, cle, meta.contentType)
      return { ok: true, cle }
    } catch {
      // Échec d'exécution (base ou R2) : aucune clé retournée → rien pour
      // l'appelant à annuler, jamais d'exception non gérée.
      return { ok: false, code: 'echec-stockage' }
    }
  }

  // Source « fichier » : rien à lire sur le profil, donc aucune requête base.
  if (!fichier) {
    return { ok: false, code: 'fichier-invalide' }
  }

  let validation: ValidationResult
  try {
    validation = await validateUpload(fichier, 'cv')
  } catch {
    // Octets illisibles : traité comme un fichier invalide, aucune écriture.
    return { ok: false, code: 'fichier-invalide' }
  }
  if (!validation.ok) {
    // Taille, type RÉEL ou signature refusés : aucune écriture.
    return { ok: false, code: 'fichier-invalide' }
  }

  try {
    // Clé servie par le serveur depuis l'extension DÉTECTÉE (jamais le nom
    // du fichier), écriture privée avec le MIME réel.
    const cle = generateKey('candidatures', validation.file.extension)
    await putPrivateObject(cle, validation.bytes, validation.file.mime)
    return { ok: true, cle }
  } catch {
    return { ok: false, code: 'echec-stockage' }
  }
}

/**
 * Rollback best-effort : supprime le snapshot si la transaction d'écriture
 * échoue (l'action V2 l'invoque sur `Candidature.create` en échec, après un
 * `preparerSnapshotCv` qui a renvoyé `ok: true`).
 *
 * Garde anti-suppression abusive : seule est supprimée une clé qui commence
 * par `candidatures/` ET qui n'y ajoute aucun sous-chemin ni traversal —
 * format exact `candidatures/<nom>.<ext>` produit par `generateKey`. Une
 * clé d'un autre préfixe (`cvs/x.pdf`), un chemin relatif (`../../evil`) ou
 * un chemin imbriqué (`candidatures/a/b.pdf`) est IGNORÉ : jamais de
 * suppression hors du périmètre des snapshots.
 *
 * La suppression elle-même est best-effort : `deleteObject` (storage.ts)
 * avale déjà ses erreurs — un échec ne bloque jamais l'action en cours.
 */
export async function annulerSnapshotCv(cle: string): Promise<void> {
  // Format EXACT d'une clé émise par generateKey('candidatures', ext) :
  // `<uuid>.<ext>` court accepté ('x.pdf') — tout reste refusé : nom vide,
  // sous-chemin, traversée (`..`, percent-encodée ou backslash), point seul
  // ou clé sans extension (revue Vague 1, O5/O6).
  const FORMAT_SNAPSHOT = /^[A-Za-z0-9-]+\.[A-Za-z0-9]{1,5}$/
  const reste = cle.startsWith(PREFIXE_SNAPSHOT)
    ? cle.slice(PREFIXE_SNAPSHOT.length)
    : null
  if (reste === null || !FORMAT_SNAPSHOT.test(reste)) {
    return
  }
  await deleteObject(cle)
}
