import type { Metadata } from 'next'

import { LoginForm } from './login-form'

// Titre court : le template global ajoute « | Job4Us ».
export const metadata: Metadata = { title: 'Connexion' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams

  // Pas de <main> ici : le layout racine fournit déjà <main id="contenu">.
  // Hauteur = viewport moins la hauteur du header (h-16) pour centrer sans
  // scroll parasite.
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12">
      <LoginForm
        registered={params.registered === '1'}
        authError={typeof params.error === 'string'}
      />
    </div>
  )
}
