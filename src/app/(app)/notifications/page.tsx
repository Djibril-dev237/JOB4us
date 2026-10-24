import type { Metadata } from 'next'
import Link from 'next/link'

import { ListeNotifications } from '@/components/notifications/liste-notifications'
import { buttonClassName } from '@/components/ui/button'
import { verifySession } from '@/lib/dal'
import { listerNotifications } from '@/lib/notifications-dal'
import { TEXTES } from '@/lib/notifications-labels'

// ─── « Mes notifications » — /notifications (M9, Vague 2) ────────────────────
//
// Miroir du pattern de session de src/app/(app)/messages/page.tsx, ADAPTÉ au
// périmètre de la cloche : 1) session AUTORITAIRE `verifySession()` — la cloche
// est visible pour candidat, recruteur ET admin (header.tsx), donc aucun
// `verifyRole('candidat','recruteur')` : un non-connecté part sur /login, un
// authentifié de n'importe quel rôle lit SES propres lignes, 2) lecture
// `listerNotifications(session.userId, null)` : l'appartenance vit dans le
// `where` du DAL, aucune vérification séparée, aucun 403 différencié.
//
// Cette page ne fournit QUE la première page : le chargement suivant
// (« Charger plus », curseur `[createdAt, id]`), les actions par carte et les
// bandeaux vivent dans <ListeNotifications> (composant client).
// Tous les textes affichés sortent de TEXTES (aucun libellé local) ; le lien
// vers /notifications/preferences utilise `TEXTES.titrePreferences` (nav.ts ne
// porte pas cette route : cf. rapport de Vague 2).
// Rendu serveur async : règle du spike #98097 — aucun loading.tsx.
// ---------------------------------------------------------------------------
export const metadata: Metadata = {
  title: TEXTES.titreNotifications,
}

export default async function PageNotifications() {
  // Session (autoritaire pour TOUS les rôles authentifiés) puis première page.
  const session = await verifySession()
  const page = await listerNotifications(session.userId, null)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-bold tracking-tight text-ink">
          {TEXTES.titreNotifications}
        </h1>

        {/* Seule entrée de la page vers les préférences (nav.ts : absente). */}
        <Link
          href="/notifications/preferences"
          className={buttonClassName('secondary', 'sm', 'shrink-0')}
        >
          {TEXTES.titrePreferences}
        </Link>
      </div>

      <ListeNotifications pageInitial={page} />
    </div>
  )
}
