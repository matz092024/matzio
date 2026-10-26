import type { SVGProps } from 'react'

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

type P = SVGProps<SVGSVGElement>

export const HomeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11h14V9" /></svg>
)
export const CompassIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
)
export const LibraryIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="9" y="4" width="4" height="16" rx="1" /><path d="m15.5 5.5 3.8-1 3.2 14.6-3.8 1z" /></svg>
)
export const GearIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
)
export const SearchIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const PlayIcon = (p: P) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
)
export const ListIcon = (p: P) => (
  <svg {...base} {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const MoonIcon = (p: P) => (
  <svg {...base} {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
)
export const InfoIcon = (p: P) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
)
export const ChevronUpIcon = (p: P) => (
  <svg {...base} {...p}><path d="m6 15 6-6 6 6" /></svg>
)
export const ChevronDownIcon = (p: P) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
)
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
)
export const ArrowLeftIcon = (p: P) => (
  <svg {...base} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
)
export const PauseIcon = (p: P) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.3" /><rect x="14" y="4.5" width="4" height="15" rx="1.3" /></svg>
)
export const VolumeIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" /><path d="M15.8 9.2a4 4 0 0 1 0 5.6" /><path d="M18.3 6.7a7.5 7.5 0 0 1 0 10.6" /></svg>
)
export const MuteIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" /><path d="m16 10 4.5 4.5M20.5 10 16 14.5" /></svg>
)
export const SubtitlesIcon = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 14h4M14 14h3" /><path d="M7 10.5h10" /></svg>
)
export const AudioIcon = (p: P) => (
  <svg {...base} {...p}><path d="M9 18V7l10-2v11" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>
)
export const ExpandIcon = (p: P) => (
  <svg {...base} {...p}><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" /></svg>
)
export const ShrinkIcon = (p: P) => (
  <svg {...base} {...p}><path d="M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5" /></svg>
)
export const CloseIcon = (p: P) => (
  <svg {...base} {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>
)
export const SkipBackIcon = (p: P) => (
  <svg {...base} {...p}><path d="M11 7V4L5 8.5 11 13v-3" /><path d="M8.5 9.5h5.5a5.5 5.5 0 1 1 0 11H9" /></svg>
)
export const SkipForwardIcon = (p: P) => (
  <svg {...base} {...p}><path d="M13 7V4l6 4.5L13 13v-3" /><path d="M15.5 9.5H10a5.5 5.5 0 1 0 0 11h5" /></svg>
)
