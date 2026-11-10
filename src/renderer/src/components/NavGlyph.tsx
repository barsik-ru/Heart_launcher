import type { SVGProps } from 'react'

type NavGlyphName = 'home' | 'news' | 'modpack' | 'profile' | 'settings'

type NavGlyphProps = SVGProps<SVGSVGElement> & {
  name: NavGlyphName
}

/** Small, hand-drawn navigation marks built for Heart's voxel/woodland visual language. */
export function NavGlyph({ name, ...props }: NavGlyphProps) {
  const common = {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...props
  }

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M2.8 9.1 9.5 3.4l6.7 5.7v7.1H11.8v-4.4H7.4v4.4H2.8V9.1Z" />
          <path d="M13.1 5.3V3.9h2.2v3.2" />
          <path d="M5.1 16.2h9.1" opacity=".48" />
        </svg>
      )
    case 'news':
      return (
        <svg {...common}>
          <path d="M4.2 2.7h8.1l3.5 3.4v10.8H4.2V2.7Z" />
          <path d="M12.2 2.9v3.6h3.4M6.5 9h6.7M6.5 11.8h6.7M6.5 14.5h4.2" />
          <path d="M2.1 5.5v11.1c0 .6.5 1.1 1.1 1.1h9.1" opacity=".5" />
        </svg>
      )
    case 'modpack':
      return (
        <svg {...common}>
          <path d="m3 6 6.5-3.1L17 6l-7.5 3.5L3 6Z" />
          <path d="m3 9.3 6.5 3.1 7.5-3.1M3 12.6l6.5 3.1 7.5-3.1" />
          <path d="M9.5 9.5v3M9.5 12.7v3" opacity=".55" />
        </svg>
      )
    case 'profile':
      return (
        <svg {...common}>
          <path d="M10 10.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
          <path d="M3.6 17c.4-3.1 2.8-4.8 6.4-4.8s6 1.7 6.4 4.8H3.6Z" />
          <path d="M15.3 4.4h1.2v2.1" opacity=".5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <path d="M3 5.2h14M3 10h14M3 14.8h14" />
          <path d="M6.2 3.7v3M12.9 8.5v3M8.7 13.3v3" strokeWidth="2.2" />
          <path d="M5 5.2h2.4M11.7 10h2.4M7.5 14.8h2.4" opacity=".35" />
        </svg>
      )
  }
}
