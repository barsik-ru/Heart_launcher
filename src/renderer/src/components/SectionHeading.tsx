import type { ReactNode } from 'react'

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>
}
