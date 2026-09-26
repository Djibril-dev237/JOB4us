'use server'

import { prisma } from '@/lib/prisma'
import { verifySession } from '@/lib/dal'
import { issuesToErrors, formDataString } from '@/lib/form-errors'
import { UpdateProfileSchema, type FormState, type UpdateProfileData } from '@/lib/definitions'

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
