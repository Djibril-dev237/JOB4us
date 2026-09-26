import type { Metadata } from 'next'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Connexion | Job4Us' }

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams

  return (
    <main className="flex min-h-screen items-start justify-center bg-white px-4 py-16">
      <LoginForm
        registered={params.registered === '1'}
        authError={typeof params.error === 'string'}
      />
    </main>
  )
}
