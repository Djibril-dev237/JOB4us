'use server'

import { prisma } from '@/lib/prisma'
import { verifyRole, verifySession } from '@/lib/dal'
import { issuesToErrors, formDataString } from '@/lib/form-errors'
import {
  DISPONIBILITE_VERS_PRISMA,
  EntrepriseSchema,
  ProfilCandidatSchema,
  UpdateProfileSchema,
  type EntrepriseFormData,
  type FormState,
  type ProfilCandidatFormData,
  type UpdateProfileData,
} from '@/lib/definitions'

/**
 * Mise à jour du profil personnel.
 *
 * POLITIQUE ANTI MASS ASSIGNMENT (audit) — contrôle en 3 niveaux :
 *
 * 1. Extraction blistée : seuls `name` et `phone` sont lus depuis le
 *    FormData (formDataString sur des clés explicites). Un payload contenant
 *    `role: "admin"`, `id`, `isActive`, `password` ou tout autre champ
 *    n'est tout simplement jamais lu.
 * 2. Validation Zod UpdateProfileSchema : .strip() (mode par défaut) retire
 *    toute clé inconnue, `role` n'existe pas dans le schéma. C'est la
 *    politique choisie pour la mise à jour : IGNORANCE SILENCIEUSE (alignée
 *    sur le $fillable Laravel de l'ancien projet), pas de rejet en erreur
 *    pour un champ qui n'a aucun effet.
 * 3. Écriture Prisma : `data: parsed.data` ne peut contenir que
 *    { name?, phone? } — le typage strict TS interdit d'ajouter role/id
 *    (erreur de compilation), et les colonnes role, isActive, emailVerifiedAt
 *    ne sont jamais dans le chemin d'écriture.
 *
 * Le critère de validation associé : un payload { name: "...", role: "admin" }
 * modifie le name, laisse le role inchangé, et ne produit aucune erreur.
 */
export async function updateProfile(
  _prevState: FormState<UpdateProfileData>,
  formData: FormData,
): Promise<FormState<UpdateProfileData>> {
  const session = await verifySession()

  const raw = {
    name: formDataString(formData.get('name')),
    phone: formDataString(formData.get('phone')),
  }

  const parsed = UpdateProfileSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }

  await prisma.user.update({
    where: { id: session.userId },
    // '' signifie numéro supprimé (colonnes nullable)
    data: {
      ...parsed.data,
      ...(parsed.data.phone === '' ? { phone: null } : {}),
    },
  })

  return { message: 'Profil mis à jour.' }
}

/**
 * Mise à jour complète du profil candidat (M3-ST8).
 *
 * SÉCURITÉ (matrice + critères M1/M3) :
 * 1. verifyRole('candidat') : un recruteur/admin ne peut pas éditer UN profil
 *    candidat (le payload `role`/`id` d'un client reste inexistant : le rôle
 *    vient du cookie de session, pas de la requête).
 * 2. Raw par clés explicites + ProfilCandidatSchema (.strip()) : `role`,
 *    `userId`, `isActive`… ne sont ni lus ni écrits (politique identique à
 *    updateProfile, critère « payload role rejeté »).
 * 3. Compétences : seuls les IDs présents dans le catalogue réel sont
 *    acceptés (inconnus ignorés, doublons dédupliqués — même ignorance
 *    silencieuse que .strip() ; legacy : sync() aurait violé une FK).
 * 4. Écriture user + candidat dans une TRANSACTION : jamais de profil à
 *    moitié mis à jour (legacy : deux save() successifs non atomiques).
 * 5. Disponibilité : colonne NOT NULL sans état « vide » — une valeur
 *    absente/vidée est laissée INCHANGEE plutôt que forcée à une valeur
 *    par défaut (pas de perte silencieuse ; legacy: `''` → erreur SQL ou
 *    null selon mode SQL, non vérifiable d'ici → arbitrage conservateur).
 */
export async function updateProfilCandidat(
  _prevState: FormState<ProfilCandidatFormData>,
  formData: FormData,
): Promise<FormState<ProfilCandidatFormData>> {
  const session = await verifyRole('candidat')

  const raw = {
    name: formDataString(formData.get('name')),
    phone: formDataString(formData.get('phone')),
    ville: formDataString(formData.get('ville')),
    titreProfil: formDataString(formData.get('titreProfil')),
    resume: formDataString(formData.get('resume')),
    dateNaissance: formDataString(formData.get('dateNaissance')),
    genre: formDataString(formData.get('genre')),
    disponibilite: formDataString(formData.get('disponibilite')),
    competences: formData
      .getAll('competences')
      .map((value) => (typeof value === 'string' ? value : '')),
  }

  const parsed = ProfilCandidatSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }
  const data = parsed.data

  const candidat = await prisma.candidat.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  })
  if (!candidat) {
    return { errors: { _form: ['Profil candidat introuvable.'] } }
  }

  const catalogue = await prisma.competence.findMany({ select: { id: true } })
  const connus = new Set(catalogue.map((competence) => competence.id))
  const competencesValides = [...new Set(data.competences.filter((id) => connus.has(id)))]

  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.userId },
      data: {
        name: data.name,
        phone: data.phone || null,
        ville: data.ville || null,
      },
    }),
    prisma.candidat.update({
      where: { id: candidat.id },
      data: {
        titreProfil: data.titreProfil || null,
        resume: data.resume || null,
        dateNaissance: data.dateNaissance ? new Date(data.dateNaissance) : null,
        genre: data.genre || null,
        ...(data.disponibilite
          ? { disponibilite: DISPONIBILITE_VERS_PRISMA[data.disponibilite] }
          : {}),
        // Remplacement intégral du jeu, équivalent strict du sync() legacy :
        // formData.getAll() renvoie [] si le champ est absent, ce qui vide le
        // pivot — exactement le sort legacy du `has('competences')` faux
        // (detach()), puis recrée les entrées retenues.
        competences: {
          deleteMany: {},
          create: competencesValides.map((competenceId) => ({ competenceId })),
        },
      },
    }),
  ])

  return { message: 'Profil mis à jour.' }
}

/**
 * Mise à jour du profil de l'entreprise du recruteur connecté (M3-ST9).
 *
 * SÉCURITÉ :
 * 1. verifyRole('recruteur') : ni candidat ni admin n'écrivent une entreprise
 *    (l'admin certifie via son propre espace, jamais ici).
 * 2. Raw par clés explicites + EntrepriseSchema (.strip()) : `isVerified`,
 *    `logo`, `userId`, `id`… ne sont ni lus ni écrits.
 * 3. Écriture UNIQUE (upsert sur l'unique userId) : une seule ligne, pas de
 *    transaction nécessaire — contrairement au legacy qui faisait
 *    GET show() = INSERT (effet de bord sur une lecture, non porté) puis
 *    save() sur update.
 * 4. `pays` est NOT NULL sans état « vide » : champ vidé = valeur inchangée
 *    (défaut de colonne « Cameroun » à la création), jamais de null forcé.
 */
export async function updateEntreprise(
  _prevState: FormState<EntrepriseFormData>,
  formData: FormData,
): Promise<FormState<EntrepriseFormData>> {
  const session = await verifyRole('recruteur')

  const raw = {
    nom: formDataString(formData.get('nom')),
    secteurActivite: formDataString(formData.get('secteurActivite')),
    tailleEntreprise: formDataString(formData.get('tailleEntreprise')),
    description: formDataString(formData.get('description')),
    siteWeb: formDataString(formData.get('siteWeb')),
    emailContact: formDataString(formData.get('emailContact')),
    telephone: formDataString(formData.get('telephone')),
    adresse: formDataString(formData.get('adresse')),
    ville: formDataString(formData.get('ville')),
    pays: formDataString(formData.get('pays')),
  }

  const parsed = EntrepriseSchema.safeParse(raw)
  if (!parsed.success) {
    return { errors: issuesToErrors(parsed.error) }
  }
  const data = parsed.data

  const champs = {
    nom: data.nom,
    secteurActivite: data.secteurActivite || null,
    tailleEntreprise: data.tailleEntreprise || null,
    description: data.description || null,
    siteWeb: data.siteWeb || null,
    emailContact: data.emailContact || null,
    telephone: data.telephone || null,
    adresse: data.adresse || null,
    ville: data.ville || null,
    ...(data.pays ? { pays: data.pays } : {}),
  }

  await prisma.entreprise.upsert({
    where: { userId: session.userId },
    update: champs,
    // Pas de ligne = création : `nom` vient du formulaire ; `pays` absent
    // hérite du défaut de colonne (M0), `logo`/`isVerified` de leurs défauts.
    create: { userId: session.userId, ...champs },
  })

  return { message: 'Profil entreprise mis à jour avec succès !' }
}
