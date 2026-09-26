import type { Metadata } from 'next'

import { RegisterForm } from './register-form'

export const metadata: Metadata = { title: 'Créer un compte | Job4Us' }

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-start justify-center bg-white px-4 py-16">
      <RegisterForm />
    </main>
  )
}
