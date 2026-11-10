import type { SVGProps } from 'react'

/** Original voxel-leaf mark used by the Verdant identity. */
export function VerdantMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 25V17h7V10h8V5h14v14h-5v8h-8v7H6v-9Z"
        fill="currentColor"
        fillOpacity=".92"
      />
      <path
        d="M10 30 29 11M17 23l-.2-6.4M23 17l6 .1M17 29h6"
        stroke="var(--surface)"
        strokeWidth="2.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  )
}
