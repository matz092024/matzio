import type { Title } from '../placeholder'

// Monochrome stand-in art until real posters come from addons.
export function artFor(tone: number) {
  const a = 18 + (tone % 20)
  const b = 6 + (tone % 9)
  const angle = (tone * 7) % 360
  return `linear-gradient(${angle}deg, hsl(0 0% ${a}%), hsl(0 0% ${b}%))`
}

export default function Poster({ title }: { title: Title }) {
  return (
    <button className="poster">
      <div className="poster-art" style={{ backgroundImage: artFor(title.tone) }}>
        <span className="poster-art-name">{title.name}</span>
      </div>
      <div className="poster-meta">
        <span className="poster-name">{title.name}</span>
        <span className="poster-sub">{title.year} · {title.genres[0]}</span>
      </div>
    </button>
  )
}
