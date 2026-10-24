import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { NOM_APPLICATION, TEXTES } from '@/lib/notifications-labels'
import { verifierJetonDesabonnement } from '@/lib/notifications-liens'
import { prisma } from '@/lib/prisma'

// ─── /desabonnement/[jeton] — désabonnement 1-clic (M9, Vague 3) ─────────────
//
// PAGE PUBLIQUE, SANS SESSION : le lien arrive dans un email, souvent lu sur
// un appareil où le compte n'est pas connecté. Le jeton HMAC (7 jours,
// signé sur AUTH_SECRET) est la SEULE autorisation : il ne donne accès qu'au
// réglage `emailsActives` de SON porteur, jamais à une autre page ni à une
// autre donnée (TEXTES.explicationJeton).
//
// POURQUOI L'ÉCRITURE A LIEU AU GET : les textes validés ne contiennent AUCUN
// libellé de bouton de confirmation, mais contiennent `desabonnementConfirme`
// (« Vous ne recevrez plus ces emails. ») et `lienReactiver` : le clic sur le
// lien de l'email EST la confirmation 1-clic. Risque connu et assumé : un
// scanner d'URL qui ouvre tous les liens d'un email déclencherait le
// désabonnement ; la page de confirmation propose la réactivation immédiate,
// et le GET ne modifie qu'un booléen réversible. Aucun autre effet de bord.
//
// RÉACTIVATION : `?reactiver=1` avec le MÊME jeton valide remet
// `emailsActives` à vrai. Le lien de réactivation est un `<a>` NATIF, jamais
// un `<Link>` Next : le prefetch d'un `<Link>` exécuterait le rendu serveur
// (donc l'écriture) sans clic de l'utilisateur.
//
// JETON INVALIDE (expiré, forgé, mal formé) : même écran, aucune écriture,
// aucune distinction entre les causes (pas d'oracle). Le jeton est vérifié
// AVANT toute requête base ; le compte supprimé rend le même écran.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: TEXTES.titreDesabonnement,
  robots: { index: false, follow: false },
}

/** Carte commune aux trois états (invalide, désabonné, réactivé). */
function CarteDesabonnement({ children }: { children: ReactNode }) {
  return (
    <main id="contenu" className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <section className="rounded-md border border-line bg-surface p-6 shadow-card sm:p-8">
        <p className="text-sm font-semibold text-brand">{NOM_APPLICATION}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
          {TEXTES.titreDesabonnement}
        </h1>
        <div className="mt-4 space-y-3 text-base leading-relaxed text-ink">{children}</div>
      </section>
    </main>
  )
}

export default async function PageDesabonnement({
  params,
  searchParams,
}: PageProps<'/desabonnement/[jeton]'>) {
  const { jeton } = await params
  const requete = await searchParams

  const verification = verifierJetonDesabonnement(jeton)
  if (verification === null) {
    return (
      <CarteDesabonnement>
        <p>{TEXTES.jetonInvalide}</p>
        <p className="text-sm text-ink-muted">{TEXTES.explicationJeton}</p>
      </CarteDesabonnement>
    )
  }

  // Compte supprimé entre l'envoi et le clic : même écran qu'un jeton
  // invalide, aucune écriture (la clé étrangère lèverait sinon un 500).
  const compte = await prisma.user.findUnique({
    where: { id: verification.userId },
    select: { id: true },
  })
  if (compte === null) {
    return (
      <CarteDesabonnement>
        <p>{TEXTES.jetonInvalide}</p>
        <p className="text-sm text-ink-muted">{TEXTES.explicationJeton}</p>
      </CarteDesabonnement>
    )
  }

  // `?reactiver=1` : réactivation ; toute autre valeur retombe sur le
  // désabonnement (le lien email ne porte aucun paramètre).
  const reactiver = requete.reactiver === '1'
  await prisma.notificationReglage.upsert({
    where: { userId: verification.userId },
    create: { userId: verification.userId, emailsActives: !reactiver },
    update: { emailsActives: !reactiver },
  })

  if (reactiver) {
    return (
      <CarteDesabonnement>
        <p>{TEXTES.reactivationConfirmee}</p>
      </CarteDesabonnement>
    )
  }

  return (
    <CarteDesabonnement>
      <p>{TEXTES.desabonnementConfirme}</p>
      <p className="text-sm">
        {/* <a> natif : jamais de prefetch sur une URL qui écrit. */}
        <a
          href={`/desabonnement/${encodeURIComponent(jeton)}?reactiver=1`}
          className="font-medium text-brand underline underline-offset-2 hover:text-brand-dark"
        >
          {TEXTES.lienReactiver}
        </a>
      </p>
    </CarteDesabonnement>
  )
}
