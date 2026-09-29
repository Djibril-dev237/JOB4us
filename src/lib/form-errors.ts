import { z } from 'zod'

/**
 * Regroupe les issues Zod par champ (clé = premier segment du path).
 * Utilisé par les Server Actions au format FormState (useActionState).
 */
export function issuesToErrors(error: z.ZodError): Partial<Record<string, string[]>> {
  const errors: Partial<Record<string, string[]>> = {}
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : '_form'
    const list = errors[key] ?? []
    list.push(issue.message)
    errors[key] = list
  }
  return errors
}

/** Extrait une chaîne du FormData (les fichiers deviennent ''). */
export function formDataString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Extrait un fichier du FormData : renvoie null si le champ est absent ou
 * vide, pour que validateUpload puisse produire un message d'erreur clair.
 */
export function formDataFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null
}
