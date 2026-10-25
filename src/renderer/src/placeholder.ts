// Stand-in titles so the shell has something to show. Step 2 replaces these with addon catalogs.

export interface Title {
  id: string
  name: string
  year: string
  kind: 'series' | 'movie'
  genres: string[]
  progress?: number
  episode?: string
  tone: number
}

const names = [
  ['The Quiet Hours', 'series', 'Drama'],
  ['Northbound', 'movie', 'Thriller'],
  ['Small Kitchen', 'series', 'Comedy'],
  ['Low Tide', 'movie', 'Mystery'],
  ['Paper Moons', 'series', 'Animation'],
  ['Static', 'movie', 'Sci-Fi'],
  ['Common Ground', 'series', 'Comedy'],
  ['After Rain', 'movie', 'Romance'],
  ['Long Shadow', 'series', 'Crime'],
  ['Glasshouse', 'movie', 'Drama'],
  ['Night Shift', 'series', 'Comedy'],
  ['Halfway', 'movie', 'Adventure'],
  ['Slow Burn', 'series', 'Drama'],
  ['Old Friends', 'series', 'Comedy']
] as const

export const titles: Title[] = names.map(([name, kind, genre], i) => ({
  id: `t${i}`,
  name,
  kind,
  year: String(2008 + ((i * 3) % 17)),
  genres: [genre],
  tone: (i * 37) % 100
}))

export const continueWatching: Title[] = [
  { ...titles[2], progress: 0.62, episode: 'S3 · E7' },
  { ...titles[10], progress: 0.18, episode: 'S1 · E4' },
  { ...titles[6], progress: 0.85, episode: 'S5 · E12' },
  { ...titles[13], progress: 0.4, episode: 'S2 · E1' }
]

export const featured = { ...titles[0], episode: 'S2 · E3', synopsis: 'A night-shift radio host keeps a small town company until sunrise, one caller at a time.' }
