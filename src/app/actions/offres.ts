'use server'

import { notFound, redirect } from 'next/navigation'

import { verifyRole } from '@/lib/dal'
import {
  ERREUR_CATEGORIE_INCONNUE,
  OffreFormSchema,
  type FormState,
  type OffreFormData,
} from '@/lib/definitions'
import { estExpiree } from '@/lib/douala'
import { offreIndisponible, offrePubliee } from '@/lib/evenements-offres'
import { formDataString, issuesToErrors } from '@/lib/form-errors'
import { entrepriseDuCompte, lireOffreGestion, lireOffreModifiable } from '@/lib/offres-dal'
import { MESSAGES_ERREUR_TRANSITION, OFFRES_ACTIVES_MAX } from '@/lib/offres-labels'
import { prisma } from '@/lib/prisma'
import {
  OFFRES_CREATION_MAX_PAR_COMPTE,
  OFFRES_CREATION_WINDOW_MS,
  checkRateLimit,
  recordAttempt,
} from '@/lib/rate-limit'
import { construireSlugOffre } from '@/lib/slug'

// ─── Actions serveur des offres côté recruteur (M6, Vague 2) ─────────────────
//
// Contrats verrouillés par la Vague 2 (partage.md) :
//
// * ORDRE DE CONTRÔLE dans CHAQUE action : 1) rôle (`verifyRole('recruteur')`),
//   2) ownership (`entrepriseDuCompte` puis lecture DAL — `null` → `notFound()`),
//   3) transition (matrice T1-T11). Jamais d'ordre inversé : une offre
//   étrangère doit mourir AVANT tout contrôle de formulaire, sinon le verdict
//   d'un champ révélerait l'existence d'une ligne d'autrui.
// * DOCTRINE 404 : offre étrangère / inexistante / supprimée → `notFound()`
//   strictement identique, JAMAIS de 403 ni de message distinct (sinon
//   énumération de /recruteur/offres/1, 2, 3…). Un `id` absent ou mal formé
//   produit le MÊME 404 qu'une offre absente.
// * RÉPONSES : succès = `redirect('/recruteur/offres?maj=<clé>')` ; refus de
//   transition = `redirect('/recruteur/offres?erreur=<clé>')` avec les 4 clés
//   de MESSAGES_ERREUR_TRANSITION (le libellé est rendu par le dashboard 2B,
//   jamais par l'URL). Seules `creerOffre` et `enregistrerModificationsOffre`
//   répondent en FormState : leur échec est une erreur de FORMULAIRE, pas un
//   changement d'état — et on ne redirige JAMAIS quand on retourne un état.
// * ANTI MASS-ASSIGNMENT : le FormData est lu par clés explicites puis validé
//   par `OffreFormSchema` (.strip). `statut`, `entrepriseId`, `slug`, `id`,
//   `deletedAt`, `vues`, `createdAt`, `updatedAt` ne viennent JAMAIS du
//   payload : `statut` sort exclusivement de la matrice, `entrepriseId`
//   uniquement de `entrepriseDuCompte(session.userId)`.
// * T11 : « expirée » n'est PAS un statut stocké (aucun cron, aucun
//   changement automatique). D3 compare la date lue à la frontière de Douala
//   (`estExpiree`), et T4 reste autorisée sur une publiée expirée : fermer
//   est toujours sur.
// ---------------------------------------------------------------------------

/** Résultat de la lecture d'un formulaire d'offre : données validées, ou erreurs de champ prêtes pour FormState. */
type LectureFormulaire =
  | { succes: true; donnees: OffreFormData; competences: number[] }
  | { succes: false; erreurs: Partial<Record<string, string[]>> }

/**
 * Lit et valide le formulaire d'offre (étape commune à la création et à
 * l'édition).
 *
 * POURQUOI ce pipeline et pas `parsed.data` étalé :
 * 1. lecture par clés EXPLICITES (`formDataString`) — un payload qui ajouterait
 *    `statut`, `entrepriseId`, `slug`… ne serait tout simplement jamais lu,
 *    et le `.strip()` du schéma les écarte une seconde fois ;
 * 2. `OffreFormSchema` tranche sur la forme et les bornes ;
 * 3. catégorie : l'appartenance au catalogue se vérifie CÔTÉ ACTION (c'est le
 *    contrat commenté à la clé `categorie_id` du schéma) — un id inconnu
 *    devient une erreur de champ au lieu d'une erreur FK au moment de
 *    l'écriture ;
 * 4. compétences : seuls les ids du catalogue RÉEL sont écrits (dédup déjà
 *    faite par le schéma) — un id inventé violerait la FK du pivot.
 */
async function lireFormulaireOffre(formData: FormData): Promise<LectureFormulaire> {
  const brut = {
    titre: formDataString(formData.get('titre')),
    categorie_id: formDataString(formData.get('categorie_id')),
    description: formDataString(formData.get('description')),
    type_contrat: formDataString(formData.get('type_contrat')),
    niveau_experience: formDataString(formData.get('niveau_experience')),
    ville: formDataString(formData.get('ville')),
    pays: formDataString(formData.get('pays')),
    date_expiration: formDataString(formData.get('date_expiration')),
    salaire_min: formDataString(formData.get('salaire_min')),
    salaire_max: formDataString(formData.get('salaire_max')),
    salaire_visible: formDataString(formData.get('salaire_visible')),
    competences: formData
      .getAll('competences')
      .map((valeur) => (typeof valeur === 'string' ? valeur : '')),
    // `.catch('enregistrer')` côté schéma : clé absente ou valeur corrompue →
    // jamais de publication par accident.
    intention: formDataString(formData.get('intention')),
  }

  const parsed = OffreFormSchema.safeParse(brut)
  if (!parsed.success) {
    return { succes: false, erreurs: issuesToErrors(parsed.error) }
  }
  const donnees = parsed.data

  const categories = await prisma.categorie.findMany({ select: { id: true } })
  if (!categories.some((categorie) => categorie.id === donnees.categorie_id)) {
    return { succes: false, erreurs: { categorie_id: [ERREUR_CATEGORIE_INCONNUE] } }
  }

  const catalogue = await prisma.competence.findMany({ select: { id: true } })
  const connus = new Set(catalogue.map((competence) => competence.id))
  const competences = donnees.competences.filter((id) => connus.has(id))

  return { succes: true, donnees, competences }
}

/**
 * LISTE BLANCHE d'écriture, commune à la création et à l'édition : ces clés
 * SEULES sont écrites, construites une par une depuis les données déjà
 * validées — jamais `...parsed.data` étalé (motif profile.ts).
 *
 * Ni `statut` (matrice seule), ni `entrepriseId` (session seule), ni `slug`
 * (construit après l'INSERT), ni `id`, `deletedAt`, `vues`, `createdAt`,
 * `updatedAt` : aucun de ces champs n'est dans la portée d'un formulaire.
 */
function champsSaisissables(donnees: OffreFormData) {
  return {
    titre: donnees.titre,
    description: donnees.description,
    typeContrat: donnees.type_contrat,
    niveauExperience: donnees.niveau_experience,
    ville: donnees.ville,
    pays: donnees.pays,
    // Le schéma produit déjà `number | null` (champSalaire) : `?? null` ne
    // sert qu'à figer le contrat « jamais undefined » au moment d'écrire.
    salaireMin: donnees.salaire_min ?? null,
    salaireMax: donnees.salaire_max ?? null,
    salaireVisible: donnees.salaire_visible,
    dateExpiration: new Date(donnees.date_expiration),
    categorieId: donnees.categorie_id,
  }
}

/**
 * Cible d'une transition : le `id` vient d'un input CACHÉ du formulaire,
 * pas de l'URL. Absent, vide ou non entier strictement positif → le MÊME
 * 404 qu'une offre inexistante, jamais une erreur distincte qui laisserait
 * sonder le paramètre.
 */
function idOffreDepuis(formData: FormData): number {
  const brut = formDataString(formData.get('id'))
  const id = Number(brut)
  if (!/^[1-9][0-9]*$/.test(brut) || !Number.isSafeInteger(id)) {
    notFound()
  }
  return id
}

/** Clé D6 partagée par la création ET la duplication : un même budget horaire. */
function cleCreationOffre(userId: number): string {
  return `offres:creation:${userId}`
}

/**
 * T1 (création) — enregistre une offre, en brouillon ou directement
 * publiée selon l'intention, puis redirige vers le dashboard.
 *
 * Ordre imposé : rôle → entreprise → D6 → validation (schéma, catégorie,
 * compétences) → D3 → D4 + écriture (transaction interactive) →
 * `recordAttempt` → redirect. Le quota et la création sont dans la MÊME
 * transaction pour qu'aucune ligne ne naisse au-delà de D4.
 */
export async function creerOffre(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await verifyRole('recruteur')

  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    // La PAGE existe, il ne manque que la ligne d'entreprise : une erreur de
    // formulaire (motif updateProfilCandidat), pas un 404.
    return { errors: { _form: ['Profil entreprise introuvable.'] } }
  }

  // D6 : contrôle AVANT toute lecture de catalogue et toute écriture.
  const cle = cleCreationOffre(session.userId)
  if (
    !checkRateLimit(cle, OFFRES_CREATION_MAX_PAR_COMPTE, OFFRES_CREATION_WINDOW_MS).allowed
  ) {
    return { errors: { _form: [MESSAGES_ERREUR_TRANSITION.limite] } }
  }

  const lecture = await lireFormulaireOffre(formData)
  if (!lecture.succes) {
    return { errors: lecture.erreurs }
  }
  const { donnees, competences } = lecture

  const publier = donnees.intention === 'publier'
  // D3 : frontière d'expiration à Douala sur la date SAISIE (un brouillon
  // peut porter une date passée ; publier, non).
  if (publier && estExpiree(new Date(donnees.date_expiration))) {
    return { errors: { _form: [MESSAGES_ERREUR_TRANSITION.date] } }
  }
  const statut = publier ? 'publiee' : 'brouillon'

  const offreCreee = await prisma.$transaction(async (tx) => {
    if (publier) {
      // D4 dans la transaction : `compterOffresPubliees` n'emprunte pas le tx,
      // donc le compte est refait ici (les publiées EXPIRÉES comptent — sinon
      // le quota serait contournable sans aucune écriture).
      const publiees = await tx.offre.count({
        where: { entrepriseId, statut: 'publiee', deletedAt: null },
      })
      if (publiees >= OFFRES_ACTIVES_MAX) {
        // Sortie SANS écrire : la transaction se termine sur un compte.
        return null
      }
    }

    const creee = await tx.offre.create({
      data: {
        ...champsSaisissables(donnees),
        statut,
        // Propriété du COMPTE, jamais d'une valeur lue dans le payload.
        entrepriseId,
        // L'id n'existe qu'après l'INSERT : on insère d'abord sans slug, on
        // le construit juste après dans la même transaction.
        slug: null,
        competences: { create: competences.map((competenceId) => ({ competenceId })) },
      },
    })

    await tx.offre.update({
      where: { id: creee.id },
      data: { slug: construireSlugOffre(donnees.titre, creee.id) },
    })

    return creee
  })

  if (offreCreee === null) {
    return { errors: { _form: [MESSAGES_ERREUR_TRANSITION.quota] } }
  }

  // APRÈS l'écriture uniquement : une tentative qui n'a rien créé ne
  // consomme pas le budget d'une heure.
  recordAttempt(cle, OFFRES_CREATION_WINDOW_MS)

  redirect(publier ? '/recruteur/offres?maj=publiee' : '/recruteur/offres?maj=brouillon')
}

/**
 * T3 + T7 (édition) — réécrit le contenu d'une offre SANS changer son
 * statut et SANS toucher à son slug.
 *
 * L'intention `publier` du formulaire est IGNORÉE (T3 : statut inchangé) et
 * aucun contrôle D3/D4 n'a lieu (T7 : prolonger la date d'une offre déjà
 * publiée, ou garder une date passée sur un brouillon, reste libre). Le slug
 * ne change jamais non plus : c'est le contrat M5 qui dispense de tout
 * UPDATE de masse si un titre est corrigé.
 */
export async function enregistrerModificationsOffre(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await verifyRole('recruteur')

  // Pas d'entreprise = aucun offre possédable : doctrine 404, pas d'erreur
  // de formulaire (contrairement à la création, où la page existe).
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    notFound()
  }

  const id = idOffreDepuis(formData)
  if ((await lireOffreModifiable(id, entrepriseId)) === null) {
    notFound()
  }

  const lecture = await lireFormulaireOffre(formData)
  if (!lecture.succes) {
    return { errors: lecture.erreurs }
  }
  const { donnees, competences } = lecture

  await prisma.offre.update({
    // Deuxième barrière d'ownership : la ligne est relue avec l'id ET
    // l'entreprise du compte ET `deletedAt: null`.
    where: { id, entrepriseId, deletedAt: null },
    data: {
      ...champsSaisissables(donnees),
      // Remplacement intégral du pivot (motif updateProfilCandidat) : un
      // formulaire qui ne renvoie AUCUNE case vide réellement le jeu, au
      // lieu de laisser subsister les anciennes lignes.
      competences: {
        deleteMany: {},
        create: competences.map((competenceId) => ({ competenceId })),
      },
    },
  })

  redirect('/recruteur/offres?maj=modifiee')
}

/**
 * T2 (publier depuis la liste) — brouillon → publiée, avec D3 puis D4
 * dans une transaction interactive.
 *
 * Les refus répondent par `?erreur=` : cette action n'a pas d'état à
 * renvoyer. Le compare-and-set porte `statut: 'brouillon'` DANS le `where`
 * : un double clic (ou une écriture concurrente) ne trouve plus la source
 * et se heurte à `?erreur=statut`.
 */
export async function publierOffre(formData: FormData): Promise<void> {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    notFound()
  }
  const id = idOffreDepuis(formData)
  const offre = await lireOffreGestion(id, entrepriseId)
  if (offre === null) {
    notFound()
  }

  if (offre.statut !== 'brouillon') {
    redirect('/recruteur/offres?erreur=statut')
  }

  // D3 sur la ligne LUE, jamais sur une date envoyée : seule une offre dont
  // la date n'est pas déjà échue à Douala peut repasser en visible.
  if (estExpiree(offre.dateExpiration)) {
    redirect('/recruteur/offres?erreur=date')
  }

  const verdict = await prisma.$transaction(async (tx) => {
    const publiees = await tx.offre.count({
      where: { entrepriseId, statut: 'publiee', deletedAt: null },
    })
    if (publiees >= OFFRES_ACTIVES_MAX) {
      return 'quota'
    }

    const miseAJour = await tx.offre.updateMany({
      where: { id, entrepriseId, statut: 'brouillon', deletedAt: null },
      data: { statut: 'publiee' },
    })
    return miseAJour.count === 0 ? 'statut' : 'ok'
  })

  if (verdict === 'quota') {
    redirect('/recruteur/offres?erreur=quota')
  }
  if (verdict === 'statut') {
    redirect('/recruteur/offres?erreur=statut')
  }

  // Événement M9 (hook branché) : la publication rend l'offre VISIBLE,
  // c'est le seul moment où les admins doivent être prévenus (jamais à la
  // réouverture T5 ni à la levée T9 : la cible est alors un brouillon).
  offrePubliee({ offreId: id })

  redirect('/recruteur/offres?maj=publiee')
}

/**
 * Squelette commun des transitions T4 (clôturer) et T5 (rouvrir) : même
 * ordre de contrôles (rôle → ownership → lecture → compare-and-set), seule
 * la paire source/cible change.
 *
 * Aucun contrôle de date ici : T4 reste autorisée sur une publiée EXPIRÉE
 * (fermer est toujours sur) et T5 ne rouvre qu'une clôturée.
 *
 * `apresSucces` (optionnel) s'exécute APRÈS le CAS réussi et AVANT la
 * redirection : c'est le point d'appel des hooks d'événements (branchements
 * M8/M9), appelé exactement quand la transition a réellement eu lieu (jamais
 * sur un refus, jamais deux fois pour un double clic — le CAS est maître).
 */
async function executerTransitionStatut(
  formData: FormData,
  source: 'publiee' | 'cloturee',
  cible: 'cloturee' | 'brouillon',
  cleMaj: 'cloturee' | 'rouverte',
  apresSucces?: (offreId: number) => void,
): Promise<void> {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    notFound()
  }
  const id = idOffreDepuis(formData)
  if ((await lireOffreGestion(id, entrepriseId)) === null) {
    notFound()
  }

  // Compare-and-set : le statut source voyage DANS le `where`, jamais relu
  // entre-temps (jamais de lecture PUIS écriture séparées pour le verdict).
  const resultat = await prisma.offre.updateMany({
    where: { id, entrepriseId, statut: source, deletedAt: null },
    data: { statut: cible },
  })
  if (resultat.count === 0) {
    redirect('/recruteur/offres?erreur=statut')
  }

  apresSucces?.(id)

  redirect(`/recruteur/offres?maj=${cleMaj}`)
}

/** T4 : publiée (y compris expirée) → clôturée. */
export async function cloturerOffre(formData: FormData): Promise<void> {
  await executerTransitionStatut(formData, 'publiee', 'cloturee', 'cloturee', (offreId) => {
    // Événement M9 (hook branché) : la clôture retire l'offre de la
    // visibilité — les candidats concernés seront prévenus. Le CAS ci-dessus
    // a déjà prouvé que la transition a eu lieu ; le rejeu d'une clôture
    // (déjà clôturée) ne repart jamais (count 0 → refus, hook non appelé).
    offreIndisponible({ offreId })
  })
}

/** T5 : clôturée → brouillon. */
export async function rouvrirOffre(formData: FormData): Promise<void> {
  await executerTransitionStatut(formData, 'cloturee', 'brouillon', 'rouverte')
}

/**
 * T6 (dupliquer) — crée une NOUVELLE ligne en brouillon à partir d'une
 * offre existante, dans sa propre entreprise.
 *
 * Une offre suspendue n'est jamais clonée (sanction en cours) : le refus
 * précède même le seau D6, puisque rien n'est alors tenté. La duplication
 * consomme le MÊME budget horaire que la création (une ligne créée est une
 * ligne créée : le budget ne se contourne pas par le bouton Dupliquer).
 */
export async function dupliquerOffre(formData: FormData): Promise<void> {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    notFound()
  }
  const id = idOffreDepuis(formData)
  const source = await lireOffreGestion(id, entrepriseId)
  if (source === null) {
    notFound()
  }
  if (source.statut === 'suspendue') {
    redirect('/recruteur/offres?erreur=statut')
  }

  const cle = cleCreationOffre(session.userId)
  if (
    !checkRateLimit(cle, OFFRES_CREATION_MAX_PAR_COMPTE, OFFRES_CREATION_WINDOW_MS).allowed
  ) {
    redirect('/recruteur/offres?erreur=limite')
  }

  // Deuxième lecture, avec la liste blanche complète : c'est elle qui fournit
  // les champs à copier et les ids du pivot.
  const modifiable = await lireOffreModifiable(id, entrepriseId)
  if (modifiable === null) {
    notFound()
  }

  await prisma.$transaction(async (tx) => {
    const copie = await tx.offre.create({
      data: {
        titre: modifiable.titre,
        description: modifiable.description,
        typeContrat: modifiable.typeContrat,
        niveauExperience: modifiable.niveauExperience,
        ville: modifiable.ville,
        pays: modifiable.pays,
        salaireMin: modifiable.salaireMin,
        salaireMax: modifiable.salaireMax,
        salaireVisible: modifiable.salaireVisible,
        dateExpiration: modifiable.dateExpiration,
        categorieId: modifiable.categorieId,
        // Recopie des SEULES colonnes de formulaire lues par la liste blanche
        // `SELECT_OFFRE_MODIFICATION`. Ni le statut de la source (la copie
        // démarre en brouillon, T6), ni son entreprise (elle appartient au
        // COMPTE courant), ni son slug (reconstruit avec le NOUVEL id), ni
        // ses dates. `vues` repart à 0 : jamais le compteur de l'originale.
        statut: 'brouillon',
        entrepriseId,
        vues: 0,
        slug: null,
        competences: {
          create: modifiable.competences.map(({ competence }) => ({
            competenceId: competence.id,
          })),
        },
      },
    })

    await tx.offre.update({
      where: { id: copie.id },
      data: { slug: construireSlugOffre(modifiable.titre, copie.id) },
    })
  })

  recordAttempt(cle, OFFRES_CREATION_WINDOW_MS)
  redirect('/recruteur/offres?maj=dupliquee')
}

/**
 * T10 (supprimer) — suppression LOGIQUE uniquement : `deletedAt` se remplit,
 * la ligne reste (les candidatures en cascade appartiennent à l'historique
 * M7, qui doit survivre).
 *
 * Aucune contrainte de statut (T10 vaut sur TOUS les statuts), mais
 * `deletedAt: null` dans le `where` : une seconde suppression ne « réussit »
 * pas deux fois, elle répond `?erreur=statut`.
 */
export async function supprimerOffre(formData: FormData): Promise<void> {
  const session = await verifyRole('recruteur')
  const entrepriseId = await entrepriseDuCompte(session.userId)
  if (entrepriseId === null) {
    notFound()
  }
  const id = idOffreDepuis(formData)
  if ((await lireOffreGestion(id, entrepriseId)) === null) {
    notFound()
  }

  const resultat = await prisma.offre.updateMany({
    where: { id, entrepriseId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  if (resultat.count === 0) {
    redirect('/recruteur/offres?erreur=statut')
  }

  // Événement M9 (hook branché) : la suppression logique retire
  // l'offre de la visibilité — même famille que clôture/suspension.
  offreIndisponible({ offreId: id })

  redirect('/recruteur/offres?maj=supprimee')
}
