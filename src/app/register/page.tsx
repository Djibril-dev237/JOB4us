import type { Metadata } from 'next'

import { RegisterForm } from './register-form'

// Titre court : le template global ajoute « | Job4Us ».
export const metadata: Metadata = { title: 'Créer un compte' }

export default function RegisterPage() {
  // Pas de <main> ici : le layout racine fournit déjà <main id="contenu">.
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-start justify-center px-4 py-12">
      <RegisterForm />
    </div>
  )
}
