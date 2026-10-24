import type { Metadata } from 'next'

import { ReglagesNotifications } from '@/components/notifications/reglages-notifications'
import { Badge } from '@/components/ui/badge'
import { verifySession } from '@/lib/dal'
import { preferencesParDefaut, TEXTES } from '@/lib/notifications-labels'
import { prisma } from '@/lib/prisma'

// ─── Préférences de notification — /notifications/preferences (M9, Vague 2) ──
//
// Miroir de session de la page liste : `verifySession()` (TOUS les rôles
// authentifiés — la cloche et ces réglages sont communs candidat, recruteur et
// admin), puis lecture DES DEUX sources d'état du compte :
//  * `NotificationPreference` : seuls les ÉCARTS au défaut sont stockés, donc
//    l'état effectif part de `preferencesParDefaut()` (source unique,
//    notifications-labels) puis les lignes en base l'écrasent — ligne absente
//    = défaut du catalogue, JAMAIS un seed ;
//  * `NotificationReglage.resumeQuotidien` : ligne absente = false (défaut du
//    modèle Prisma, cf. schema.prisma).
//
// `signalementRecu` n'apparaît dans aucun interrupteur (cf. l'arbitrage
// commenté dans reglages-notifications.tsx) : aucun texte local, aucun
// contrôle absent, et l'action refuse d'ailleurs d'écrire pour ce type.
// Intro et canal in-app (statiques) sont rendus ICI, seuls les interrupteurs
// forment un îlot client. Tous les textes sortent de TEXTES.
// Rendu serveur async : règle du spike #98097 — aucun loading.tsx.
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: TEXTES.titrePreferences,
}

export default async function PagePreferencesNotifications() {
  const session = await verifySession()

  const [preferences, reglage] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId: session.userId },
      select: { type: true, emailActive: true },
    }),
    prisma.notificationReglage.findUnique({
      where: { userId: session.userId },
      select: { resumeQuotidien: true },
    }),
  ])

  // État EFFECTIF : défaut du catalogue, puis les écarts réellement stockés.
  const etatsEmails = preferencesParDefaut()
  for (const ligne of preferences) {
    etatsEmails[ligne.type] = ligne.emailActive
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{TEXTES.titrePreferences}</h1>
        <p className="mt-2 text-base text-ink-muted">{TEXTES.introPreferences}</p>
      </div>

      <ReglagesNotifications
        etatsEmails={etatsEmails}
        resumeQuotidien={reglage?.resumeQuotidien ?? false}
      />

      {/* Canal in-app : AUCUN réglage possible (toujours actif), statique. */}
      <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 shadow-card">
        <p className="min-w-0 text-sm text-ink">{TEXTES.canalApplication}</p>
        <Badge variant="ok">{TEXTES.badgeToujoursActif}</Badge>
      </section>
    </div>
  )
}
