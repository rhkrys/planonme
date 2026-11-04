export const BLOCK_KINDS = ['talk', 'exercise', 'break', 'discussion'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

export interface Block {
  id: string
  title: string
  kind: BlockKind
  durationMin: number
  goal: string
  notes: string
  /** Script text with inline cue tokens such as [SLIDE 4] or [SFX applause]. */
  script: string
}

export interface Workshop {
  id: string
  title: string
  /** Calendar date as YYYY-MM-DD, or an empty string when not set. */
  date: string
  durationMin: number
  blocks: Block[]
  slideDeckIds: string[]
  soundIds: string[]
  createdAt: number
  updatedAt: number
}

export interface WorkshopSummary {
  id: string
  title: string
}

export const DECK_SOURCES = ['pptx', 'gslides', 'canva', 'gamma', 'pdf'] as const
export type DeckSource = (typeof DECK_SOURCES)[number]

export interface SlideDeck {
  id: string
  workshopId: string
  name: string
  source: DeckSource
  /** One image per slide, in order. */
  slides: Blob[]
}

export const SOUND_KINDS = ['music', 'sfx'] as const
export type SoundKind = (typeof SOUND_KINDS)[number]

export interface Sound {
  id: string
  workshopId: string
  name: string
  kind: SoundKind
  blob: Blob
  loop: boolean
  /** Gain from 0 to 1. */
  volume: number
  /** A single key name, or an empty string for no hotkey. */
  hotkey: string
  /** A color as #rrggbb, or an empty string for the default color. */
  color: string
}

export interface MetaRow {
  key: string
  value: unknown
}
