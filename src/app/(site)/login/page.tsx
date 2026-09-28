import type { Metadata } from 'next'

import { LoginForm } from './login-form'

// Titre court : le template global ajoute « | Job4Us ».
export const metadata: Metadata = { title: 'Connexion' }

// Page volontairement SYNCHRONE (aucun `await searchParams`) :
// une page qui suspend sous `loading.tsx` n'est jamais hydratée sur
// Next 16.3.6 (bug upstream vercel/next.js#98097, squelette bloqué,
// aucune erreur console). Les flags d'URL (?registered, ?error) sont
// donc lus côté client dans LoginForm.
export default function LoginPage() {
  // Pas de <main> ici : le layout racine fournit déjà <main id="contenu">.
  // Hauteur = viewport moins la hauteur du header (h-16) pour centrer sans
  // scroll parasite.
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <LoginForm />
    </div>
  )
}
