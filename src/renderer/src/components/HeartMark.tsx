import type { SVGProps } from 'react'

/** Pixel-heart mark for the Heart launcher identity. */
export function HeartMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}>
      <path d="M20 34 5.8 20.2C-1.2 11.8 10.1 1.8 18.1 9.1L20 11l1.9-1.9c8-7.3 19.3 2.7 12.3 11.1L20 34Z" fill="currentColor" fillOpacity=".96"/>
      <path d="M10 16.5c1.1-3.2 4.5-4.5 7.1-2.4" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" opacity=".72"/>
    </svg>
  )
}
