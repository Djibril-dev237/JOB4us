'use server'

import { prisma } from '@/lib/prisma'
import { verifyRole, verifySession } from '@/lib/dal'
import { formDataFile } from '@/lib/form-errors'
import { validateUpload } from '@/lib/files'
import { deleteObject, generateKey, putPrivateObject } from '@/lib/storage'
import type { FormState } from '@/lib/definitions'

// ─── Envoi sécurisé des fichiers (server actions) ─────────────────────────────
// Chaîne d'envoi appliquée ici (matrice d'accès : ST3/ST5) :
//
// 1. Session AVANT toute lecture de fichier : un non connecté reçoit un
//    redirect (401 équivalent) et aucun octet n'est traité.
// 2. Rôle exigé : CV = candidat uniquement ; avatar = tout compte
//    authentifié (aligné sur les paramètres legacy).
// 3. validateUpload : présence, taille (5 Mo CV / 2 Mo image), type RÉEL lu
//    dans les octets (liste blanche ; SVG refusé) — aucun écriture tant que
//    tout n'est pas conforme.
// 4. Clé UUID serveur (jamais le nom d'origine) puis écriture R2 PRIVÉE.
// 5. Ordre de remplacement : upload du nouveau → bascule de la base →
//    suppression de l'ancien objet (best-effort) : jamais de fenêtre où le
//    profil serait sans fichier.
// 6. Seule la CLÉ (ex. `cvs/<uuid>.pdf`) est persistée — jamais d'URL.
//
// Pas de rate limiting ici : chaque action est bornée à la session (cookie
// de session signé) et le payload est plafonné par validateUpload avant
// écriture ; le middleware de limitation de tentatives de connexion couvre
// l'entrée non authentifiée du site.
// ---------------------------------------------------------------------------

/**
 * Dépose le CV du candidat connecté (remplace l'éventuel CV précédent).
 */
export async function uploadCv(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await verifyRole('candidat')

  const result = await validateUpload(formDataFile(formData.get('cv')), 'cv')
  if (!result.ok) {
    return { errors: { _form: [result.error] } }
  }

  const candidat = await prisma.candidat.findUnique({
    where: { userId: session.userId },
    select: { id: true, cvPath: true },
  })
  if (!candidat) {
    return { errors: { _form: ['Profil candidat introuvable.'] } }
  }

  const key = generateKey('cvs', result.file.extension)
  await putPrivateObject(key, result.bytes, result.file.mime)

  // Bascule de la clé AVANT suppression de l'ancien objet (voir règle 5).
  await prisma.candidat.update({
    where: { id: candidat.id },
    data: { cvPath: key },
  })
  if (candidat.cvPath) {
    await deleteObject(candidat.cvPath)
  }

  return { message: 'CV enregistré.' }
}

/**
 * Dépose la photo de profil de l'utilisateur connecté (tous rôles).
 * Stockée sur `User.avatar` ; l'entreprise dispose par ailleurs de son
 * logo (action dédiée en sous-tâche M3, même chaîne).
 */
export async function uploadAvatar(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await verifySession()

  const result = await validateUpload(formDataFile(formData.get('avatar')), 'avatar')
  if (!result.ok) {
    return { errors: { _form: [result.error] } }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { avatar: true },
  })
  if (!user) {
    return { errors: { _form: ['Compte introuvable.'] } }
  }

  const key = generateKey('avatars', result.file.extension)
  await putPrivateObject(key, result.bytes, result.file.mime)

  await prisma.user.update({
    where: { id: session.userId },
    data: { avatar: key },
  })
  if (user.avatar) {
    await deleteObject(user.avatar)
  }

  return { message: 'Photo de profil mise à jour.' }
}

/**
 * Dépose le logo de l'entreprise du recruteur connecté (M3-ST9).
 * Même chaîne que l'avatar (validateUpload images 2 Mo, clé UUID, R2
 * privée, bascule puis suppression de l'ancien objet). Le champ `logo`
 * n'est LISIBLE nulle part ailleurs : le formulaire de profil entreprise
 * (EntrepriseSchema) ne l'expose pas (mass-assign impossible).
 */
export async function uploadLogo(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await verifyRole('recruteur')

  const result = await validateUpload(formDataFile(formData.get('logo')), 'logo')
  if (!result.ok) {
    return { errors: { _form: [result.error] } }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      name: true,
      entreprise: { select: { id: true, logo: true } },
    },
  })
  if (!user) {
    return { errors: { _form: ['Compte introuvable.'] } }
  }

  const key = generateKey('logos', result.file.extension)
  await putPrivateObject(key, result.bytes, result.file.mime)

  // Bascule AVANT suppression de l'ancien objet (règle 5 de l'en-tête).
  const logoPrecedent = user.entreprise?.logo ?? null
  if (user.entreprise) {
    await prisma.entreprise.update({
      where: { id: user.entreprise.id },
      data: { logo: key },
    })
  } else {
    // Ligne absente (compte plus ancien que l'inscription courante) :
    // création avec le nom du compte, exactement comme le registre legacy
    // (RegisterController::registered) — JAMAIS depuis un GET.
    await prisma.entreprise.create({
      data: { userId: session.userId, nom: user.name, logo: key },
    })
  }
  if (logoPrecedent) {
    await deleteObject(logoPrecedent)
  }

  return { message: 'Logo mis à jour.' }
}
