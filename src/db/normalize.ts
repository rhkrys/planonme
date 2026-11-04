// Stored data is untrusted (other tabs, old versions, manual edits, browser bugs).
// These helpers turn whatever comes out of IndexedDB into well formed records, or null.

import { AUDIO_TYPE_PATTERN, COLOR_PATTERN, DATE_PATTERN, LIMITS } from './limits'
import {
  BLOCK_KINDS,
  DECK_SOURCES,
  SOUND_KINDS,
  type Block,
  type BlockKind,
  type DeckSource,
  type SlideDeck,
  type Sound,
  type SoundKind,
  type Workshop,
} from './types'

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.find((o) => o === v) ?? fallback
}

function id(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= LIMITS.maxIdLength ? v : null
}

function idList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v.slice(0, max)) {
    const ok = id(item)
    if (ok && !out.includes(ok)) out.push(ok)
  }
  return out
}

export function normalizeTitle(v: unknown, fallback = 'Untitled workshop'): string {
  const t = text(v, LIMITS.maxTitleLength).trim()
  return t.length > 0 ? t : fallback
}

export function normalizeBlock(raw: unknown): Block | null {
  if (!isRecord(raw)) return null
  const blockId = id(raw.id)
  if (!blockId) return null
  return {
    id: blockId,
    title: text(raw.title, LIMITS.maxTitleLength),
    kind: oneOf<BlockKind>(raw.kind, BLOCK_KINDS, 'talk'),
    durationMin: int(raw.durationMin, 0, LIMITS.maxBlockMinutes, 0),
    goal: text(raw.goal, LIMITS.maxGoalLength),
    notes: text(raw.notes, LIMITS.maxNotesLength),
    script: text(raw.script, LIMITS.maxScriptLength),
  }
}

export function normalizeWorkshop(raw: unknown): Workshop | null {
  if (!isRecord(raw)) return null
  const workshopId = id(raw.id)
  if (!workshopId) return null
  const blocks: Block[] = []
  if (Array.isArray(raw.blocks)) {
    for (const b of raw.blocks.slice(0, LIMITS.maxBlocks)) {
      const block = normalizeBlock(b)
      if (block && !blocks.some((x) => x.id === block.id)) blocks.push(block)
    }
  }
  const date = text(raw.date, 10)
  return {
    id: workshopId,
    title: normalizeTitle(raw.title),
    date: DATE_PATTERN.test(date) ? date : '',
    durationMin: int(raw.durationMin, 0, LIMITS.maxWorkshopMinutes, 0),
    blocks,
    slideDeckIds: idList(raw.slideDeckIds, LIMITS.maxDecks),
    soundIds: idList(raw.soundIds, LIMITS.maxSounds),
    createdAt: int(raw.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: int(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}

export function normalizeSlideDeck(raw: unknown): SlideDeck | null {
  if (!isRecord(raw)) return null
  const deckId = id(raw.id)
  const workshopId = id(raw.workshopId)
  if (!deckId || !workshopId) return null
  const slides = Array.isArray(raw.slides)
    ? raw.slides.slice(0, LIMITS.maxSlidesPerDeck).filter((s): s is Blob => s instanceof Blob)
    : []
  return {
    id: deckId,
    workshopId,
    name: normalizeTitle(raw.name, 'Untitled deck'),
    source: oneOf<DeckSource>(raw.source, DECK_SOURCES, 'pdf'),
    slides,
  }
}

export function normalizeSound(raw: unknown): Sound | null {
  if (!isRecord(raw)) return null
  const soundId = id(raw.id)
  const workshopId = id(raw.workshopId)
  if (!soundId || !workshopId || !(raw.blob instanceof Blob)) return null
  const volume =
    typeof raw.volume === 'number' && Number.isFinite(raw.volume)
      ? Math.min(1, Math.max(0, raw.volume))
      : 1
  const color = text(raw.color, 7)
  return {
    id: soundId,
    workshopId,
    name: normalizeTitle(raw.name, 'Untitled sound'),
    kind: oneOf<SoundKind>(raw.kind, SOUND_KINDS, 'sfx'),
    blob: raw.blob,
    loop: raw.loop === true,
    volume,
    hotkey: text(raw.hotkey, LIMITS.maxHotkeyLength),
    color: COLOR_PATTERN.test(color) ? color : '',
  }
}

/** True when a MIME type is acceptable for a stored or imported sound. */
export function isAudioType(type: string): boolean {
  return type.length <= LIMITS.maxMimeLength && AUDIO_TYPE_PATTERN.test(type)
}
