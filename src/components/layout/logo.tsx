import Link from 'next/link'

// ─── Logo Job4Us ─────────────────────────────────────────────────────────────
// Nom et logo conservés à l'identique du legacy (badge bleu + icône + lockup
// « Job » bleu / « 4Us » orange + tagline). Seuls les jetons changent :
// bleu de marque #0066FF -> token brand (#0A58E6, contraste AA), tagline
// relevée de 9,3px/2,6:1 à 12px/5,3:1 (diagnostic M2-1), badge ramené au
// rayon système 6px (l'échelle est fermée à 4/6/8px).
// ---------------------------------------------------------------------------

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      <span
        className="flex size-9 items-center justify-center rounded-md bg-brand"
        aria-hidden="true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <span className="hidden border-l border-line pl-2.5 leading-none sm:block">
        <span className="block text-xl font-black tracking-tight">
          <span className="text-brand">Job</span>
          <span className="text-accent">4Us</span>
        </span>
        <span className="mt-1 block text-2xs font-semibold uppercase tracking-[0.15em] text-ink-muted">
          Cameroun · Afrique
        </span>
      </span>
    </Link>
  )
}
