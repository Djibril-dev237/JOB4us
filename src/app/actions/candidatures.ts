'use server'

import { Prisma } from '@prisma/client'
import { notFound, redirect } from 'next/navigation'

import {
  ACTION_AUDIT_CREATION,
  ACTION_AUDIT_RETRAIT,
  ACTION_AUDIT_TRANSITION,
  journaliserCandidature,
} from '@/lib/candidature-audit'
import { annulerSnapshotCv, preparerSnapshotCv } from '@/lib/candidature-cv'
import {
  STATUTS_TERMINAUX,
  peutTransiter,
  type ActeurCandidature,
} from '@/lib/candidatures-labels'
import { schemaChangementStatut, schemaPostulation } from '@/lib/candidatures-schemas'
import { verifyRole } from '@/lib/dal'
import {
  candidatureEnvoyee,
  candidatureRetiree,
  statutChange,
} from '@/lib/evenements-candidature'
import { formDataFile, formDataString } from '@/lib/form-errors'
import { lireOffrePublique } from '@/lib/offres-public'
import { prisma } from '@/lib/prisma'
import {
  CANDIDATURES_MAX_PAR_COMPTE,
  CANDIDATURES_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'
import { estSlugOffreValide } from '@/lib/slug'

// ─── Actions serveur des candidatures (M7) ───────────────────────────────────
//
// Contrats repris AU MOT de src/app/actions/offres.ts (M6, Vague 2) :
//
// * ORDRE DE CONTRÔLE : 1) rôle (`verifyRole`), 2) ownership (lecture portant
//   le périmètre — `null` → `notFound()`), 3) transition (matrice TRANSITIONS
//   de src/lib/candidatures-labels.ts, via `peutTransiter` — jamais une logique
//   recopiée). Jamais d'ordre inversé : la ligne d'autrui doit mourir
//   AVANT toute écriture, et AUCUN verdict d'un champ ne doit dépendre de
//   l'existence de la ligne — dans changerStatutCandidature, la cible Zod
//   est donc validée AVANT l'ownership (P3-3 revue M7) : cible invalide et
//   ligne absente y partagent le même refus, sans oracle possible.
// * DOCTRINE 404 : ligne inexistante, d'un autre candidat, d'un autre
//   recruteur, `id` absent ou mal formé → `notFound()` STRICTEMENT identique,
//   jamais de 403 ni de message distinct (sinon énumération de
//   /candidat/candidatures/1, 2, 3…). Seuls les refus « métier » répondent en
//   `?erreur=`.
// * COMPAR-AND-SET : tout verdict d'écriture passe par `updateMany` avec la
//   source DANS le `where` (périmètre + statut courant) — jamais une lecture
//   PUIS une écriture. Les lectures de contrôle ci-dessous (ownership de la
//   ligne, `offreId` de l'événement, statut courant de la matrice) servent à
//   mourir en 404 et à CONSTRUIRE l'événement et l'audit ; la décision,
//   elle, appartient au CAS : `count === 0` → refus, y compris sur un double
//   clic.
// * ANTI MASS-ASSIGNMENT : le FormData est lu PAR CLÉS (`formDataString` /
//   `formDataFile`) puis validé par `schemaPostulation` /
//   `schemaChangementStatut`, tous deux `.strict()` : `statut`, `offreId`,
//   `candidatId`, `cvPath` ne viennent JAMAIS du payload. La cible d'une
//   transition sort du schéma, le droit sort de la matrice, le statut stocké
//   sort du CAS.
// * LISTE BLANCHE d'écriture : `candidature.create` ne reçoit que
//   `{ offreId, candidatId, lettreMotivation, cvPath }` — SANS `statut` :
//   `envoyee` n'est JAMAIS une cible de transition (matrice), seul le CREATE
//   l'écrit, aucun bouton ne peut le réécrire.
// * RÉPONSES : succès = `redirect(...?maj=<clé>)`, refus = `redirect(...?erreur=<clé>)`
//   (clés de MESSAGES_MAJ_CANDIDATURE / MESSAGES_ERREUR_CANDIDATURE ; le
//   libellé est rendu par la page cible, jamais par l'URL, et une clé
//   inconnue n'affiche rien — fail-closed). Aucune action M7 ne renvoie de
//   FormState : les 4 signatures sont `Promise<void>`.
//   CIBLES (intégration M7) : la postulation redirige vers
//   `/offres/<slug>/postuler` — SEULE page qui rend la confirmation
//   (?maj=envoyee remplace le formulaire) et les bandeaux d'erreur ; le
//   retrait vers la liste du candidat, le changement de statut vers la
//   liste du recruteur (qui hébergent les bandeaux ?maj=/?erreur=).
// * AUDIT : les 4 actions écrivent `AuditCandidature` VIA
//   src/lib/candidature-audit.ts (constantes source `ACTION_AUDIT_*` + type
//   union strict) — `creation` (postulerOffre), `retrait`
//   (retirerCandidature), `transition` (changerStatutCandidature ET le
//   passage auto `envoyee → consultee` de marquerConsultee). Politique
//   verrouillée : acteur = `session.userId` PARTOUT (jamais `candidat.id`,
//   cohérent avec logCvAccess) ; création / retrait / transition sont
//   ATOMIQUES avec la mutation (fail-closed) — la ligne d’audit vit dans la
//   MÊME `$transaction`, seulement si la création ou le CAS réussit
//   (`count === 1`), donc un échec d’audit ANNULE la mutation ; AUCUN audit
//   sur un refus (P2002, `?erreur=`, 404). marquerConsultee reste
//   best-effort : son try/catch absorbe l’échec d’audit. Les 3 hooks de
//   src/lib/evenements-candidature.ts restent le point de branchement M8/M9,
//   sans lien avec l’audit (cf. src/lib/candidature-audit.ts).
// ---------------------------------------------------------------------------

/** Clé du seau M7 : partagée par le COMPTE, jamais par l'offre (calque D6). */
function cleSeauPostulation(userId: number): string {
  return `candidatures:postulation:${userId}`
}

/**
 * `id` d'une candidature : champ CACHÉ du formulaire, jamais l'URL. Absent,
 * vide ou non entier strictement positif → le MÊME 404 qu'une ligne
 * absente, jamais une erreur distincte qui laisserait sonder le paramètre
 * (motif `idOffreDepuis` de offres.ts).
 */
function idCandidatureDepuis(formData: FormData): number {
  const brut = formDataString(formData.get('id'))
  const id = Number(brut)
  if (!/^[1-9][0-9]*$/.test(brut) || !Number.isSafeInteger(id)) {
    notFound()
  }
  return id
}

/**
 * `Candidat.id` déduit du COMPTE de la session — jamais d'une saisie.
 * `null` (compte sans profil candidat, rôle revendiqué sans ligne) → 404,
 * comme toute donnée de périmètre absente.
 */
async function candidatDuCompte(userId: number): Promise<number> {
  const candidat = await prisma.candidat.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (candidat === null) {
    notFound()
  }
  return candidat.id
}

/**
 * Lecture de contrôle du retrait : alimente l’événement M8/M9 (`offreId`) et
 * l’audit (`statut` = ancien statut consigné dans `AuditCandidature`).
 */
const SELECT_CONTROLE_RETRAIT = {
  offreId: true,
  candidatId: true,
  statut: true,
} satisfies Prisma.CandidatureSelect

/** Lecture de contrôle de la transition : périmètre + statut courant (matrice). */
const SELECT_CONTROLE_TRANSITION = {
  statut: true,
  offreId: true,
  candidatId: true,
} satisfies Prisma.CandidatureSelect

/**
 * POSTULER à une offre publique (candidat).
 *
 * Ordre IMPÉRATIF : 1) rôle → 2) seau M7 → 3) offre → 4) candidat →
 * 5) payload (`schemaPostulation`) → 6) snapshot CV → 7) écriture (la
 * candidature ET sa ligne d’audit `creation`, même `$transaction`) →
 * 8) `recordAttempt` + événement + redirect.
 *
 * Deux décisions à documenter :
 *
 * a) OFFRE INDISPONIBLE ≠ OFFRE ABSENTE. `lireOffrePublique` renvoie `null`
 *    pour les deux (prédicat unique M5). Une SECONDE lecture sans prédicat
 *    (`findUnique` par slug) les départage : slug inconnu → `notFound()`
 *    (doctrine 404, aucun message) ; slug connu mais non visible →
 *    `?erreur=offre-indisponible` SEULEMENT si l'offre a jadis été publique
 *    (clôturée, expirée, supprimée, recruteur suspendu) — un brouillon
 *    partage le 404 du slug absent (P2-1 revue M7 : son existence est
 *    secrète, aucun slug n'en a jamais été public), car le critère M7 exige que le candidat
 *    soit prévenu qu'une offre QU'IL A PU VOIR n'est plus recevable. Le
 *    départage ne révèle rien : l'existence d'une offre ETRANGÈRE n'est pas
 *    en jeu : seule la disponibilité d'une offre jadis publique est
 *    révélée, jamais l'existence d'une ligne secrète.
 *
 * b) REFUS DE FORMULAIRE → `?erreur=fichier-invalide`. C'est l'unique refus
 *    de formulaire de l'action et il porte toutes les échecs Zod (lettre >
 *    3000 caractères, `sourceCv` hors enum, `fichier` absent/inattendu) :
 *    AUCUNE clé dédiée « lettre trop longue » n'existe dans
 *    MESSAGES_ERREUR_CANDIDATURE, et `fichier-invalide` est le substitut
 *    retenu par l'intégrateur — le formulaire côté client empêchant
 *    réellement > 3000 via `maxLength`. Le snapshot, lui, a ses 3 codes.
 */
export async function postulerOffre(formData: FormData): Promise<void> {
  // 1) RÔLE : un visiteur meurt ici, avant toute lecture.
  const session = await verifyRole('candidat')

  const slug = formDataString(formData.get('slug'))
  // Format M5 (`titre-slug-<id>`) exigé AVANT toute utilisation : un slug
  // forgé contenant `?` ou `#` réécrirait la query/le fragment des cibles
  // ci-dessous (revue M7, P3-10). Invalide = même 404 qu'une offre absente.
  if (!estSlugOffreValide(slug)) {
    notFound()
  }

  // 2) Seau M7 : AVANT toute lecture de candidature et toute écriture.
  const cleSeau = cleSeauPostulation(session.userId)
  if (
    !checkRateLimit(cleSeau, CANDIDATURES_MAX_PAR_COMPTE, CANDIDATURES_WINDOW_MS).allowed
  ) {
    redirect(`/offres/${slug}/postuler?erreur=trop-de-demandes`)
  }

  // 3) Offre : visible (id exploitable) / existante mais non visible /
  //    absente — cf. décision (a) ci-dessus.
  const offre = await lireOffrePublique(slug)
  if (offre === null) {
    const existante = await prisma.offre.findUnique({
      where: { slug },
      select: { statut: true },
    })
    // Revue M7 (P2-1) : un brouillon n'a AUCUN slug publiquement
    // résoluble — son existence même est secrète, donc il partage le 404
    // du slug absent (doctrine M5 « aucune fuite d'existence »). Seules les
    // offres JADIS publiées (clôturée, expirée, supprimée, recruteur
    // suspendu) répondent `?erreur=offre-indisponible`.
    if (existante === null || existante.statut === 'brouillon') {
      notFound()
    }
    // Cible = la liste du candidat, JAMAIS /postuler : cette page relit
    // l'offre et 404 dès qu'elle est invisible (même 404 que la fiche), ce
    // qui rendrait le message inatteignable — et l'afficher ici sur /postuler
    // créerait un oracle d'existence sur les brouillons (bandeau si la ligne
    // existe, 404 sinon — cas M5 « aucune fuite d'existence »). La liste
    // candidat héberge déjà les bandeaux ?erreur= via messageErreurCandidature.
    redirect('/candidat/candidatures?erreur=offre-indisponible')
  }
  const offreId = offre.id

  // 4) Candidat de la SESSION : jamais d'id de candidat dans le payload.
  const candidatId = await candidatDuCompte(session.userId)

  // 5) Payload lu PAR CLÉS puis validé (.strict()) : `''` sur la lettre devient
  //    `undefined` (colonne nullable), tout autre champ forgeé n'est jamais lu.
  const lettreBrute = formDataString(formData.get('lettreMotivation'))
  const payload = schemaPostulation.safeParse({
    lettreMotivation: lettreBrute === '' ? undefined : lettreBrute,
    sourceCv: formDataString(formData.get('sourceCv')),
    fichier: formDataFile(formData.get('fichier')) ?? undefined,
  })
  if (!payload.success) {
    // Décision (b) ci-dessus : clé unique des refus de formulaire M7.
    redirect(`/offres/${slug}/postuler?erreur=fichier-invalide`)
  }

  // 6) Snapshot CV : clé cible servie par le serveur, validation/compression
  //    AVANT toute écriture base. `ok:false` → aucun objet référencé, donc
  //    rien à annuler.
  const snapshot = await preparerSnapshotCv({
    candidatId,
    source: payload.data.sourceCv,
    fichier: payload.data.fichier,
  })
  if (!snapshot.ok) {
    redirect(`/offres/${slug}/postuler?erreur=${snapshot.code}`)
  }
  const cvPath = snapshot.cle

  // 7) Écriture : liste blanche stricte, SANS statut (défaut `envoyee`), sans
  //    autre champ — puis la ligne d’audit `creation`, dans la MÊME
  //    transaction et APRÈS la création (fail-closed : si l’audit échoue, la
  //    candidature est annulée avec lui). Le rollback du snapshot vit HORS
  //    transaction, autour du `$transaction` : le create peut avoir échoué
  //    APRÈS la copie de l’objet, et un échec d’audit roule entier — le
  //    catch ci-dessous absorbe les DEUX (aucune logique à dupliquer).
  let candidatureId: number
  try {
    candidatureId = await prisma.$transaction(async (tx) => {
      const creee = await tx.candidature.create({
        data: {
          offreId,
          candidatId,
          lettreMotivation: payload.data.lettreMotivation ?? null,
          cvPath,
        },
      })
      await journaliserCandidature(tx, {
        candidatureId: creee.id,
        acteurId: session.userId,
        action: ACTION_AUDIT_CREATION,
        ancienStatut: null,
        nouveauStatut: 'envoyee',
      })
      return creee.id
    })
  } catch (erreur) {
    // Rollback best-effort du snapshot orphelin, QUEL QUE soit le motif.
    await annulerSnapshotCv(cvPath)
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
      // Unicité DB (offreId, candidatId) : double clic / double onglet —
      // la ligne existe déjà, la tentative ne consomme PAS le seau, et
      // l’audit `creation` n’a JAMAIS été écrit (création échouée avant).
      redirect(`/offres/${slug}/postuler?erreur=doublon`)
    }
    throw erreur
  }

  // 8) Succès : le budget M7 n'est consommé qu'ICI (une tentative refusée
  //    ne paye rien), puis événement (M8) et redirection.
  recordAttempt(cleSeau, CANDIDATURES_WINDOW_MS)
  candidatureEnvoyee({ candidatureId, offreId, candidatId })
  redirect(`/offres/${slug}/postuler?maj=envoyee`)
}

/**
 * RETIRER sa candidature (candidat) — `retiree` remplace la suppression
 * physique du legacy (la ligne et son historique M7 survivent).
 *
 * Ordre : rôle → candidat du compte → id (404) → lecture de contrôle →
 * compare-and-set + audit `retrait` (MÊME `$transaction`, fail-closed).
 *
 * La `findUnique` de contrôle ne sert QU'à alimenter l'événement (`offreId`),
 * l’audit (`statut` = ancien statut consigné) et à mourir en 404 pour une
 * ligne d'autrui : le VERDICT reste le CAS ci-dessous, dont le `where` porte
 * à la fois `candidatId` ET l'exclusion des statuts terminaux. Deux verdicts
 * distincts, aucun oracle (P3-1 revue M7) : ligne inexistante OU d'un autre
 * candidat → `notFound()` (404
 * strict, doctrine M7) ; ligne existante mais déjà terminale →
 * `?erreur=retrait` : refus de formulaire, jamais une fuite d'existence.
 * `count === 0` n’écrit AUCUNE ligne d’audit (jamais de trace sans mutation).
 */
export async function retirerCandidature(formData: FormData): Promise<void> {
  const session = await verifyRole('candidat')
  const candidatId = await candidatDuCompte(session.userId)
  const id = idCandidatureDepuis(formData)

  const ligne = await prisma.candidature.findUnique({
    where: { id },
    select: SELECT_CONTROLE_RETRAIT,
  })
  if (ligne === null || ligne.candidatId !== candidatId) {
    // Doctrine 404 : la candidature d'un autre compte est indiscernable
    // d'une candidature absente (aucun `?erreur=` distinct).
    notFound()
  }

  // CAS + audit ATOMIQUES : la mutation et sa ligne `retrait` partagent la
  // MÊME $transaction — `count === 0` → ni l’une ni l’autre (aucune trace
  // sans mutation), et un échec d’audit roule la mise à jour entière.
  const resultat = await prisma.$transaction(async (tx) => {
    const verdict = await tx.candidature.updateMany({
      // CAS : périmètre + exclusion des terminaux DANS le `where`, jamais une
      // lecture de statut suivie d'une écriture.
      where: { id, candidatId, statut: { notIn: [...STATUTS_TERMINAUX] } },
      data: { statut: 'retiree' },
    })
    if (verdict.count === 1) {
      await journaliserCandidature(tx, {
        candidatureId: id,
        acteurId: session.userId,
        action: ACTION_AUDIT_RETRAIT,
        ancienStatut: ligne.statut,
        nouveauStatut: 'retiree',
      })
    }
    return verdict.count
  })
  if (resultat === 0) {
    redirect('/candidat/candidatures?erreur=retrait')
  }

  candidatureRetiree({ candidatureId: id, offreId: ligne.offreId, candidatId })
  redirect('/candidat/candidatures?maj=retiree')
}

/**
 * CHANGER le statut d'une candidature (recruteur OU admin).
 *
 * Ordre imposé : 1) rôle → 2) id → 3) cible (schéma) → 4) ownership + statut
 * courant EN UNE requête → 5) matrice → 6) CAS + audit `transition` (MÊME
 * `$transaction`, fail-closed) → 7) événement + redirect.
 *
 * Le recruteur est borné par la jointure `offre → entreprise → userId` posée
 * DANS le `where` de la lecture ET dans celui du CAS ; l'admin, lui, n'a
 * aucun périmètre (lecture globale déjà ouverte par `verifyRole`, décision
 * étape 2) — mais reste soumis à la matrice comme tout acteur.
 */
export async function changerStatutCandidature(formData: FormData): Promise<void> {
  // 1) RÔLE : l'acteur décide de la transition, pas l'URL.
  const session = await verifyRole('recruteur', 'admin')
  const acteur: ActeurCandidature = session.role

  // 2) id : champ caché, même 404 que l'absence de ligne.
  const id = idCandidatureDepuis(formData)

  // 3) CIBLE : sortie de `schemaChangementStatut` (.strict(), 7 valeurs) ;
  //    hors enum → le MÊME refus qu'une transition interdite.
  const parseCible = schemaChangementStatut.safeParse({
    statut: formDataString(formData.get('vers')),
  })
  if (!parseCible.success) {
    redirect('/recruteur/candidatures?erreur=transition')
  }
  const vers = parseCible.data.statut

  // 4) Ownership + statut courant EN UNE seule requête (select liste
  //    blanche) : `null` → 404, identique pour une ligne d'un autre compte.
  const ligne =
    acteur === 'recruteur'
      ? await prisma.candidature.findFirst({
          where: { id, offre: { entreprise: { userId: session.userId } } },
          select: SELECT_CONTROLE_TRANSITION,
        })
      : await prisma.candidature.findUnique({
          where: { id },
          select: SELECT_CONTROLE_TRANSITION,
        })
  if (ligne === null) {
    notFound()
  }

  // 5) Matrice T-transitions : source unique, fail-closed (toute
  //    combinaison absente est refusée, y compris `consultee → entretien`).
  if (!peutTransiter(ligne.statut, vers, acteur)) {
    redirect('/recruteur/candidatures?erreur=transition')
  }

  // 6) Compare-and-set + audit ATOMIQUES : statut source + périmètre DANS le
  //    `where` — une écriture concurrente (ou un double clic) ne trouve plus
  //    la source et se heurte au MÊME refus. L’audit `transition` n’est écrit
  //    QUE si le CAS a touché la ligne (`count === 1`) ; un échec d’audit
  //    roule la mise à jour entière (fail-closed : aucune transition sans
  //    trace), et un refus (interdit, 404, CAS à zéro) n’écrit rien.
  const resultat = await prisma.$transaction(async (tx) => {
    const verdict = await tx.candidature.updateMany({
      where: {
        id,
        statut: ligne.statut,
        ...(acteur === 'recruteur'
          ? { offre: { entreprise: { userId: session.userId } } }
          : {}),
      },
      data: { statut: vers },
    })
    if (verdict.count === 1) {
      await journaliserCandidature(tx, {
        candidatureId: id,
        acteurId: session.userId,
        action: ACTION_AUDIT_TRANSITION,
        ancienStatut: ligne.statut,
        nouveauStatut: vers,
      })
    }
    return verdict.count
  })
  if (resultat === 0) {
    redirect('/recruteur/candidatures?erreur=transition')
  }

  // 7) Événement (M9) puis `?maj=statut` : cette clé n'a PAS de message dans
  //    MESSAGES_MAJ_CANDIDATURE (fail-closed — `messageMajCandidature('statut')`
  //    → null, aucun bandeau, jamais de texte inventé). Le feedback est le
  //    badge à jour sur la ligne relue par la page : le bandeau dupliquerait
  //    l'information sans rien apprendre de plus.
  statutChange({
    candidatureId: id,
    offreId: ligne.offreId,
    candidatId: ligne.candidatId,
    ancienStatut: ligne.statut,
    nouveauStatut: vers,
    acteurId: session.userId,
  })
  redirect('/recruteur/candidatures?maj=statut')
}

/**
 * Passer `envoyee` → `consultee` : appelée par les PAGES serveur (recruteur)
 * à l'ouverture d'une fiche — JAMAIS un bouton. L'acteur de ce passage est
 * le SERVEUR lui-même (matrice : recruteur/admin), pas une action exposée au
 * client : aucun formulaire ne peut l'invoquer.
 *
 * GARDE D'AUTORISATION (revue M7, P1-1) : toute export d'un fichier
 * 'use server' est un point d'entrée HTTP invocable en POST direct — le
 * contrôle d'origine (anti-CSRF) n'exige AUCUNE session. Rôle et périmètre
 * (jointure offre → entreprise → userId côté recruteur) sont donc
 * revérifiés ICI, même si la page appelante l'a déjà fait ; la redirection
 * de `verifyRole` hors rôle est avalee par le best-effort ci-dessous.
 *
 * Best-effort SILENCIEUX : try/catch sans log et sans re-throw — un badge qui
 * ne peut pas bouger ne fait jamais échouer le rendu d'une page. L'écriture
 * est rendue sûre par son propre compare-and-set (`statut: 'envoyee'` DANS le
 * `where`) : l'appartenance de la ligne a déjà été vérifiée par la page via
 * le DAL, et une ligne dont le statut a changé entre-temps n'est simplement
 * pas touchée (`count === 0` ignoré).
 *
 * Aucun hook M8/M9 ici (cette page n’en déclenche aucun) ; l’audit
 * `transition` (`envoyee → consultee`, acteur = `session.userId`, le compte
 * recruteur/admin dont la session a ouvert la page) s’écrit DANS la
 * `$transaction`, sur le CAS ci-dessous : best-effort ATOMIQUE — un échec
 * d’audit annule d’abord la mutation, puis est absorbé par le try/catch.
 */
export async function marquerConsultee(candidatureId: number): Promise<void> {
  try {
    const session = await verifyRole('recruteur', 'admin')
    await prisma.$transaction(async (tx) => {
      const verdict = await tx.candidature.updateMany({
        where: {
          id: candidatureId,
          statut: 'envoyee',
          ...(session.role === 'recruteur'
            ? { offre: { entreprise: { userId: session.userId } } }
            : {}),
        },
        data: { statut: 'consultee' },
      })
      if (verdict.count === 1) {
        await journaliserCandidature(tx, {
          candidatureId,
          acteurId: session.userId,
          action: ACTION_AUDIT_TRANSITION,
          ancienStatut: 'envoyee',
          nouveauStatut: 'consultee',
        })
      }
    })
  } catch {
    // Best-effort : jamais d'exception propagée, jamais de log.
  }
}
