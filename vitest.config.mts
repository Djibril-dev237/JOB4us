import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` lève une erreur hors composant serveur React : remplacé
      // par un stub vide pour tester les modules serveur sous Node.
      'server-only': fileURLToPath(new URL('./src/tests/server-only.stub.ts', import.meta.url)),
    },
  },
})
