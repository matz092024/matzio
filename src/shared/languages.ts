// Languages for the audio and subtitle preferences, shared by Settings and the player.
// Files tag tracks with two- or three-letter ISO 639 codes (and three-letter ones come in
// two spellings for some languages, like ger/deu), so each language keeps every form.

export interface Language {
  /** ISO 639-1, which is what Settings stores. */
  code: string
  name: string
  /** Every other code files use for it. */
  alt: string[]
}

export const languages: Language[] = [
  { code: 'en', name: 'English', alt: ['eng'] },
  { code: 'es', name: 'Spanish', alt: ['spa'] },
  { code: 'fr', name: 'French', alt: ['fre', 'fra'] },
  { code: 'de', name: 'German', alt: ['ger', 'deu'] },
  { code: 'it', name: 'Italian', alt: ['ita'] },
  { code: 'pt', name: 'Portuguese', alt: ['por'] },
  { code: 'nl', name: 'Dutch', alt: ['dut', 'nld'] },
  { code: 'sv', name: 'Swedish', alt: ['swe'] },
  { code: 'no', name: 'Norwegian', alt: ['nor', 'nob', 'nb', 'nno', 'nn'] },
  { code: 'da', name: 'Danish', alt: ['dan'] },
  { code: 'fi', name: 'Finnish', alt: ['fin'] },
  { code: 'is', name: 'Icelandic', alt: ['ice', 'isl'] },
  { code: 'pl', name: 'Polish', alt: ['pol'] },
  { code: 'cs', name: 'Czech', alt: ['cze', 'ces'] },
  { code: 'sk', name: 'Slovak', alt: ['slo', 'slk'] },
  { code: 'hu', name: 'Hungarian', alt: ['hun'] },
  { code: 'ro', name: 'Romanian', alt: ['rum', 'ron'] },
  { code: 'bg', name: 'Bulgarian', alt: ['bul'] },
  { code: 'hr', name: 'Croatian', alt: ['hrv'] },
  { code: 'sr', name: 'Serbian', alt: ['srp'] },
  { code: 'sl', name: 'Slovenian', alt: ['slv'] },
  { code: 'el', name: 'Greek', alt: ['gre', 'ell'] },
  { code: 'tr', name: 'Turkish', alt: ['tur'] },
  { code: 'ru', name: 'Russian', alt: ['rus'] },
  { code: 'uk', name: 'Ukrainian', alt: ['ukr'] },
  { code: 'ar', name: 'Arabic', alt: ['ara'] },
  { code: 'he', name: 'Hebrew', alt: ['heb', 'iw'] },
  { code: 'fa', name: 'Persian', alt: ['per', 'fas'] },
  { code: 'hi', name: 'Hindi', alt: ['hin'] },
  { code: 'ta', name: 'Tamil', alt: ['tam'] },
  { code: 'te', name: 'Telugu', alt: ['tel'] },
  { code: 'bn', name: 'Bengali', alt: ['ben'] },
  { code: 'th', name: 'Thai', alt: ['tha'] },
  { code: 'vi', name: 'Vietnamese', alt: ['vie'] },
  { code: 'id', name: 'Indonesian', alt: ['ind', 'in'] },
  { code: 'ms', name: 'Malay', alt: ['may', 'msa'] },
  { code: 'tl', name: 'Filipino', alt: ['fil', 'tgl'] },
  { code: 'zh', name: 'Chinese', alt: ['chi', 'zho', 'cmn', 'yue'] },
  { code: 'ja', name: 'Japanese', alt: ['jpn'] },
  { code: 'ko', name: 'Korean', alt: ['kor'] }
]

const byCode = new Map<string, Language>()
for (const l of languages) for (const c of [l.code, ...l.alt]) byCode.set(c, l)

/** The two-letter code for a track's language tag ("eng", "en-US", "pt-BR" all work), or the tag itself if unknown. */
export function normalizeLang(tag: string | undefined | null): string {
  const base = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return byCode.get(base)?.code ?? base
}

/** Every code a file might use for a language, for mpv's --alang and --slang. */
export function langCodes(code: string): string[] {
  const l = byCode.get(code.toLowerCase())
  return l ? [l.code, ...l.alt] : [code.toLowerCase()]
}

export function langName(code: string): string {
  return byCode.get(code.toLowerCase())?.name ?? code.toUpperCase()
}
