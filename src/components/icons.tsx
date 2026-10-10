import type { SVGProps } from 'react'

// ─── Icônes SVG en ligne ─────────────────────────────────────────────────────
// Style : trait 1.8, extrémités arrondies, currentColor — cohérent avec le
// trait du logo legacy. Aucune dépendance d'iconographie : jeu minimal,
// étendu module par module au fur et à mesure des besoins.
// ---------------------------------------------------------------------------

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

export function IconBell({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

export function IconSearch({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export function IconChevronDown({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconMenu({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  )
}

export function IconClose({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function IconSettings({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconLogout({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

export function IconBriefcase({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </svg>
  )
}

export function IconMapPin({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

export function IconBarChart({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M5 20v-7" />
      <path d="M12 20V4" />
      <path d="M19 20v-11" />
    </svg>
  )
}

export function IconArrowRight({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M4 12h16" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

export function IconTag({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2c0 .5.2 1 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  )
}

export function IconFileText({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  )
}

export function IconWrench({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
    </svg>
  )
}

export function IconGrid({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

export function IconInfo({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5" />
      <path d="M12 8h.01" />
    </svg>
  )
}

export function IconBuilding({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h.01" />
      <path d="M15 8h.01" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M10 21v-3h4v3" />
    </svg>
  )
}

export function IconChat({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

export function IconSend({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  )
}

export function IconArrowLeft({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}

export function IconBan({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  )
}

export function IconFlag({ size, ...props }: IconProps) {
  return (
    <svg {...base({ size, ...props })}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </svg>
  )
}
