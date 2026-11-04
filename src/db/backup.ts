// Export and import of one workshop as a ".planonme" backup file.
// The file is JSON with all media embedded as base64. Imported files are untrusted: every field
// is checked, counts and sizes are capped, and all ids are regenerated.

import { base64DecodedLength, base64ToBytes, bytesToBase64, isBase64 } from './base64'
import type { PlanOnMeDB } from './db'
import { newId } from './ids'
import { COLOR_PATTERN, DATE_PATTERN, LIMITS, SLIDE_IMAGE_TYPES } from './limits'
import { isAudioType, isRecord, normalizeTitle } from './normalize'
import { getWorkshop, listSlideDecks, listSounds, listWorkshops } from './repo'
import {
  BLOCK_KINDS,
  DECK_SOURCES,
  SOUND_KINDS,
  type Block,
  type DeckSource,
  type SlideDeck,
  type Sound,
  type SoundKind,
  type Workshop,
} from './types'

export const BACKUP_FORMAT = 'planonme'
export const BACKUP_VERSION = 1
export const BACKUP_EXTENSION = '.planonme'
export const BACKUP_MIME = 'application/json'

/** An error with a message that is safe and useful to show to the user. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function fail(message: string): never {
  throw new BackupError(message)
}

const MB = 1024 * 1024
function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`
}

// ---------------------------------------------------------------------------------------------
// Export

export interface ExportedFile {
  filename: string
  blob: Blob
}

export function backupFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 60)
  return `${slug || 'workshop'}${BACKUP_EXTENSION}`
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** JSON for an object followed by a base64 "data" field, built without one giant string. */
function withData(meta: Record<string, unknown>, data: string): string[] {
  const json = JSON.stringify(meta)
  const open = json.length > 2 ? `${json.slice(0, -1)},` : '{'
  return [open, '"data":"', data, '"}']
}

/** Builds the backup file for one workshop. */
export async function exportWorkshop(db: PlanOnMeDB, workshopId: string): Promise<ExportedFile> {
  const workshop = await getWorkshop(db, workshopId)
  if (!workshop) fail('That workshop no longer exists.')
  const decks = await listSlideDecks(db, workshop)
  const sounds = await listSounds(db, workshop)

  let mediaBytes = 0
  for (const d of decks) for (const s of d.slides) mediaBytes += s.size
  for (const s of sounds) mediaBytes += s.blob.size
  if (mediaBytes > LIMITS.maxMediaBytes) {
    fail(`This workshop has more than ${formatMb(LIMITS.maxMediaBytes)} of media to export.`)
  }

  const head = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    workshop: {
      title: workshop.title,
      date: workshop.date,
      durationMin: workshop.durationMin,
      blocks: workshop.blocks,
    },
  }
  const headJson = JSON.stringify(head)
  const parts: string[] = [headJson.slice(0, -1), ',"slideDecks":[']

  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i]
    if (!deck) continue
    if (i > 0) parts.push(',')
    const deckJson = JSON.stringify({ id: deck.id, name: deck.name, source: deck.source })
    parts.push(deckJson.slice(0, -1), ',"slides":[')
    for (let j = 0; j < deck.slides.length; j++) {
      const slide = deck.slides[j]
      if (!slide) continue
      if (j > 0) parts.push(',')
      parts.push(...withData({ type: slide.type || 'image/png' }, await blobToBase64(slide)))
    }
    parts.push(']}')
  }
  parts.push('],"sounds":[')
  for (let i = 0; i < sounds.length; i++) {
    const sound = sounds[i]
    if (!sound) continue
    if (i > 0) parts.push(',')
    const meta = {
      id: sound.id,
      name: sound.name,
      kind: sound.kind,
      type: isAudioType(sound.blob.type) ? sound.blob.type : 'audio/unknown',
      loop: sound.loop,
      volume: sound.volume,
      hotkey: sound.hotkey,
      color: sound.color,
    }
    parts.push(...withData(meta, await blobToBase64(sound.blob)))
  }
  parts.push(']}')

  const blob = new Blob(parts, { type: BACKUP_MIME })
  if (blob.size > LIMITS.maxFileBytes) {
    fail(`This workshop is too large to export (over ${formatMb(LIMITS.maxFileBytes)}).`)
  }
  return { filename: backupFilename(workshop.title), blob }
}

// ---------------------------------------------------------------------------------------------
// Import

interface PendingMedia {
  type: string
  data: string
  label: string
}

export interface ParsedBackup {
  workshop: Pick<Workshop, 'title' | 'date' | 'durationMin' | 'blocks'>
  slideDecks: Array<Pick<SlideDeck, 'name' | 'source' | 'slides'>>
  sounds: Array<Omit<Sound, 'id' | 'workshopId'>>
}

function record(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) fail(`${what} is not valid.`)
  return v
}

function text(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string') fail(`${what} must be text.`)
  if (v.length > max) fail(`${what} is too long (most allowed is ${max} characters).`)
  return v
}

function wholeNumber(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${what} must be a whole number.`)
  if (v < min || v > max) fail(`${what} must be between ${min} and ${max}.`)
  return v
}

function list(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v)) fail(`${what} must be a list.`)
  if (v.length > max) fail(`${what} has too many items (most allowed is ${max}).`)
  return v
}

function choice<T extends string>(v: unknown, options: readonly T[], what: string): T {
  const found = options.find((o) => o === v)
  if (found === undefined) fail(`${what} must be one of: ${options.join(', ')}.`)
  return found
}

function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') fail(`${what} must be true or false.`)
  return v
}

function mediaData(v: unknown, maxBytes: number, what: string): string {
  if (typeof v !== 'string') fail(`${what} must be base64 text.`)
  if (v.length === 0) fail(`${what} is empty.`)
  // Check the length before scanning the text so huge values fail fast.
  if (v.length > Math.ceil(maxBytes / 3) * 4) {
    fail(`${what} is too large (most allowed is ${formatMb(maxBytes)}).`)
  }
  if (!isBase64(v)) fail(`${what} is not valid base64.`)
  if (base64DecodedLength(v) > maxBytes) {
    fail(`${what} is too large (most allowed is ${formatMb(maxBytes)}).`)
  }
  return v
}

function parseBlock(raw: unknown, n: number): Block {
  const what = `Block ${n}`
  const b = record(raw, what)
  return {
    id: newId(),
    title: text(b.title, LIMITS.maxTitleLength, `${what} title`),
    kind: choice(b.kind, BLOCK_KINDS, `${what} kind`),
    durationMin: wholeNumber(b.durationMin, 0, LIMITS.maxBlockMinutes, `${what} duration`),
    goal: text(b.goal, LIMITS.maxGoalLength, `${what} goal`),
    notes: text(b.notes, LIMITS.maxNotesLength, `${what} notes`),
    script: text(b.script, LIMITS.maxScriptLength, `${what} script`),
  }
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, i) => bytes[offset + i] === value)
}

function looksLikeImage(bytes: Uint8Array, type: string): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      )
    default:
      return false
  }
}

function decode(media: PendingMedia): Uint8Array<ArrayBuffer> {
  try {
    return base64ToBytes(media.data)
  } catch {
    fail(`${media.label} is not valid base64.`)
  }
}

/** Checks a parsed JSON value and turns it into decoded workshop data. Throws BackupError. */
export function parseBackup(json: unknown): ParsedBackup {
  const root = record(json, 'The file')
  if (root.format !== BACKUP_FORMAT) fail('This is not a PlanOnMe backup file.')
  if (typeof root.version !== 'number' || !Number.isInteger(root.version)) {
    fail('The file has no valid format version.')
  }
  if (root.version > BACKUP_VERSION) {
    fail('This file was made by a newer version of PlanOnMe. Please update the app.')
  }
  if (root.version !== BACKUP_VERSION) fail(`Format version ${root.version} is not supported.`)

  const w = record(root.workshop, 'The workshop')
  const date = text(w.date, 10, 'Workshop date')
  if (date !== '' && !DATE_PATTERN.test(date)) fail('Workshop date must look like 2025-01-31.')
  const blocks = list(w.blocks, LIMITS.maxBlocks, 'Blocks').map((b, i) => parseBlock(b, i + 1))
  const workshop: ParsedBackup['workshop'] = {
    title: normalizeTitle(text(w.title, LIMITS.maxTitleLength, 'Workshop title')),
    date,
    durationMin: wholeNumber(w.durationMin, 0, LIMITS.maxWorkshopMinutes, 'Workshop duration'),
    blocks,
  }

  // First pass: check every field and add up media sizes without decoding anything.
  let mediaBytes = 0
  let slideCount = 0
  const decks: Array<{ name: string; source: DeckSource; slides: PendingMedia[] }> = []
  const rawDecks = list(root.slideDecks, LIMITS.maxDecks, 'Slide decks')
  rawDecks.forEach((rawDeck, i) => {
    const what = `Slide deck ${i + 1}`
    const d = record(rawDeck, what)
    const rawSlides = list(d.slides, LIMITS.maxSlidesPerDeck, `${what} slides`)
    slideCount += rawSlides.length
    if (slideCount > LIMITS.maxSlidesTotal) {
      fail(`The file has too many slides (most allowed is ${LIMITS.maxSlidesTotal}).`)
    }
    const slides = rawSlides.map((rawSlide, j) => {
      const label = `Slide ${j + 1} in deck ${i + 1}`
      const s = record(rawSlide, label)
      const type = choice(s.type, SLIDE_IMAGE_TYPES, `${label} type`)
      const data = mediaData(s.data, LIMITS.maxSlideBytes, `${label} image`)
      mediaBytes += base64DecodedLength(data)
      return { type, data, label: `${label} image` }
    })
    decks.push({
      name: normalizeTitle(text(d.name, LIMITS.maxTitleLength, `${what} name`), 'Untitled deck'),
      source: choice(d.source, DECK_SOURCES, `${what} source`),
      slides,
    })
  })

  const sounds: Array<Omit<Sound, 'id' | 'workshopId' | 'blob'> & { media: PendingMedia }> = []
  const rawSounds = list(root.sounds, LIMITS.maxSounds, 'Sounds')
  rawSounds.forEach((rawSound, i) => {
    const what = `Sound ${i + 1}`
    const s = record(rawSound, what)
    const type = text(s.type, LIMITS.maxMimeLength, `${what} type`)
    if (!isAudioType(type)) fail(`${what} type must be an audio type such as audio/mpeg.`)
    const data = mediaData(s.data, LIMITS.maxSoundBytes, `${what} audio`)
    mediaBytes += base64DecodedLength(data)
    if (
      typeof s.volume !== 'number' ||
      !Number.isFinite(s.volume) ||
      s.volume < 0 ||
      s.volume > 1
    ) {
      fail(`${what} volume must be a number from 0 to 1.`)
    }
    const color = text(s.color, 7, `${what} color`)
    if (color !== '' && !COLOR_PATTERN.test(color)) fail(`${what} color must look like #ff8800.`)
    sounds.push({
      name: normalizeTitle(text(s.name, LIMITS.maxTitleLength, `${what} name`), 'Untitled sound'),
      kind: choice<SoundKind>(s.kind, SOUND_KINDS, `${what} kind`),
      loop: bool(s.loop, `${what} loop`),
      volume: s.volume,
      hotkey: text(s.hotkey, LIMITS.maxHotkeyLength, `${what} hotkey`),
      color,
      media: { type, data, label: `${what} audio` },
    })
  })

  if (mediaBytes > LIMITS.maxMediaBytes) {
    fail(`The file has more than ${formatMb(LIMITS.maxMediaBytes)} of media.`)
  }

  // Second pass: decode media now that every size is known to be in range.
  const slideDecks = decks.map((d) => ({
    name: d.name,
    source: d.source,
    slides: d.slides.map((m) => {
      const bytes = decode(m)
      if (!looksLikeImage(bytes, m.type)) fail(`${m.label} is not a valid ${m.type} file.`)
      return new Blob([bytes], { type: m.type })
    }),
  }))
  const decodedSounds = sounds.map(({ media, ...rest }) => ({
    ...rest,
    blob: new Blob([decode(media)], { type: media.type }),
  }))

  return { workshop, slideDecks, sounds: decodedSounds }
}

/** Reads and checks a backup file. Throws BackupError with a readable message. */
export async function readBackupFile(file: Blob): Promise<ParsedBackup> {
  if (file.size === 0) fail('The file is empty.')
  if (file.size > LIMITS.maxFileBytes) {
    fail(`The file is too large (most allowed is ${formatMb(LIMITS.maxFileBytes)}).`)
  }
  let content: string
  try {
    content = await file.text()
  } catch {
    fail('The file could not be read.')
  }
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    fail('The file is damaged or cut off (it is not valid JSON).')
  }
  try {
    return parseBackup(json)
  } catch (err) {
    if (err instanceof BackupError) throw err
    // Anything unexpected (for example running out of memory) still gets a readable message.
    fail('The file could not be imported.')
  }
}

function uniqueTitle(title: string, taken: Set<string>): string {
  if (!taken.has(title)) return title
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`
    const candidate = title.slice(0, LIMITS.maxTitleLength - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
  return title
}

/** Imports a backup file as a new workshop with fresh ids. Throws BackupError. */
export async function importWorkshop(db: PlanOnMeDB, file: Blob): Promise<Workshop> {
  const parsed = await readBackupFile(file)
  const existing = await listWorkshops(db)
  const now = Date.now()
  const workshopId = newId()
  const decks: SlideDeck[] = parsed.slideDecks.map((d) => ({ ...d, id: newId(), workshopId }))
  const sounds: Sound[] = parsed.sounds.map((s) => ({ ...s, id: newId(), workshopId }))
  const workshop: Workshop = {
    ...parsed.workshop,
    id: workshopId,
    title: uniqueTitle(parsed.workshop.title, new Set(existing.map((w) => w.title))),
    slideDeckIds: decks.map((d) => d.id),
    soundIds: sounds.map((s) => s.id),
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.workshops, db.slideDecks, db.sounds, async () => {
    await db.slideDecks.bulkAdd(decks)
    await db.sounds.bulkAdd(sounds)
    await db.workshops.add(workshop)
  })
  return workshop
}
