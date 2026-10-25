import type { ReactNode } from 'react'

export default function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="row">
      <h2 className="row-title">{title}</h2>
      <div className="row-track">{children}</div>
    </section>
  )
}
