import { hotkeyFromKey, hotkeyProblem } from '../audio/hotkeys'
import { soundKey } from '../cues/check'
import type { PlanOnMeDB } from './db'
import { newId } from './ids'
import { COLOR_PATTERN, LIMITS } from './limits'
import {
  isAudioType,
  normalizeSlideDeck,
  normalizeSound,
  normalizeTitle,
  normalizeWorkshop,
} from './normalize'
import {
  SOUND_KINDS,
  type SlideDeck,
  type Sound,
  type SoundKind,
  type Workshop,
  type WorkshopSummary,
} from './types'

const CURRENT_KEY = 'currentWorkshopId'
const MB = 1024 * 1024

/** The workshop is gone, for example because another tab deleted it. */
export class WorkshopNotFoundError extends Error {
  constructor() {
    super('This workshop no longer exists. It may have been deleted in another tab.')
    this.name = 'WorkshopNotFoundError'
  }
}

/** The slide deck is gone, for example because another tab deleted it. */
export class DeckNotFoundError extends Error {
  constructor() {
    super('This slide deck no longer exists. It may have been deleted in another tab.')
    this.name = 'DeckNotFoundError'
  }
}

/** The sound is gone, for example because another tab deleted it. */
export class SoundNotFoundError extends Error {
  constructor() {
    super('This sound no longer exists. It may have been deleted in another tab.')
    this.name = 'SoundNotFoundError'
  }
}

/** A sound setting cannot be used, such as a hotkey another sound has. The message says why. */
export class SoundSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoundSettingsError'
  }
}

/** Adding media would go over one of the limits in LIMITS. The message says which. */
export class MediaLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaLimitError'
  }
}

export function blankWorkshop(title: string): Workshop {
  const now = Date.now()
  return {
    id: newId(),
    title: normalizeTitle(title),
    date: '',
    durationMin: 60,
    blocks: [],
    slideDeckIds: [],
    soundIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** All workshops, sorted by title. Damaged rows are skipped. */
export async function listWorkshops(db: PlanOnMeDB): Promise<WorkshopSummary[]> {
  const rows: unknown[] = await db.workshops.toArray()
  const out: WorkshopSummary[] = []
  for (const row of rows) {
    const w = normalizeWorkshop(row)
    if (w) out.push({ id: w.id, title: w.title })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

export async function getWorkshop(db: PlanOnMeDB, id: string): Promise<Workshop | null> {
  const row: unknown = await db.workshops.get(id)
  return normalizeWorkshop(row)
}

export async function createWorkshop(db: PlanOnMeDB, title: string): Promise<Workshop> {
  const w = blankWorkshop(title)
  await db.workshops.add(w)
  return w
}

/** Saves a workshop after cleaning it, and returns the saved copy. */
export async function saveWorkshop(db: PlanOnMeDB, workshop: Workshop): Promise<Workshop> {
  // Always later than the copy it replaces, even within one millisecond, so another tab can tell
  // that it changed.
  const updatedAt = Math.max(Date.now(), (workshop.updatedAt || 0) + 1)
  const clean = normalizeWorkshop({ ...workshop, updatedAt })
  if (!clean) throw new Error('Workshop data is not valid')
  await db.workshops.put(clean)
  return clean
}

/** Saves changes to a workshop that must still exist, so a stale copy never brings it back. */
export async function updateWorkshop(db: PlanOnMeDB, workshop: Workshop): Promise<Workshop> {
  return db.transaction('rw', db.workshops, async () => {
    if ((await db.workshops.get(workshop.id)) === undefined) throw new WorkshopNotFoundError()
    return saveWorkshop(db, workshop)
  })
}

export async function renameWorkshop(db: PlanOnMeDB, id: string, title: string): Promise<Workshop> {
  return db.transaction('rw', db.workshops, async () => {
    const w = await getWorkshop(db, id)
    if (!w) throw new WorkshopNotFoundError()
    return saveWorkshop(db, { ...w, title: normalizeTitle(title) })
  })
}

/** Deletes a workshop with all its slide decks and sounds. */
export async function deleteWorkshop(db: PlanOnMeDB, id: string): Promise<void> {
  await db.transaction('rw', db.workshops, db.slideDecks, db.sounds, async () => {
    await db.slideDecks.where('workshopId').equals(id).delete()
    await db.sounds.where('workshopId').equals(id).delete()
    await db.workshops.delete(id)
  })
}

/** Slide decks of a workshop in the order of workshop.slideDeckIds. */
export async function listSlideDecks(db: PlanOnMeDB, workshop: Workshop): Promise<SlideDeck[]> {
  const rows: unknown[] = await db.slideDecks.where('workshopId').equals(workshop.id).toArray()
  const decks = rows.map(normalizeSlideDeck).filter((d): d is SlideDeck => d !== null)
  return orderById(decks, workshop.slideDeckIds)
}

/** Sounds of a workshop in the order of workshop.soundIds. */
export async function listSounds(db: PlanOnMeDB, workshop: Workshop): Promise<Sound[]> {
  const rows: unknown[] = await db.sounds.where('workshopId').equals(workshop.id).toArray()
  const sounds = rows.map(normalizeSound).filter((s): s is Sound => s !== null)
  return orderById(sounds, workshop.soundIds)
}

/** Names and counts of a workshop's slides and sounds, without the media itself. */
export interface MediaSummary {
  /** In the order of workshop.slideDeckIds. */
  decks: { id: string; name: string; slideCount: number }[]
  /** In the order of workshop.soundIds. */
  sounds: { id: string; name: string; kind: SoundKind }[]
}

/** Lists the slide decks and sounds of a workshop for cue checks and autocomplete. */
export async function getMediaSummary(db: PlanOnMeDB, workshop: Workshop): Promise<MediaSummary> {
  const [decks, sounds] = await Promise.all([
    listSlideDecks(db, workshop),
    listSounds(db, workshop),
  ])
  return {
    decks: decks.map((d) => ({ id: d.id, name: d.name, slideCount: d.slides.length })),
    sounds: sounds.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  }
}

function orderById<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...items].sort((a, b) => rank(a.id) - rank(b.id))
}

/** Bytes of all slides and sounds of a workshop. */
async function mediaBytes(db: PlanOnMeDB, w: Workshop): Promise<number> {
  const decks = await listSlideDecks(db, w)
  const sounds = await listSounds(db, w)
  let total = 0
  for (const d of decks) for (const s of d.slides) total += s.size
  for (const s of sounds) total += s.blob.size
  return total
}

function mediaLimitError(): MediaLimitError {
  return new MediaLimitError(
    `A workshop can hold up to ${Math.round(LIMITS.maxMediaBytes / MB)} MB of slides and sounds, so it still fits in a backup file. Delete some first.`,
  )
}

/** Adds a slide deck to a workshop. */
export async function addSlideDeck(
  db: PlanOnMeDB,
  workshopId: string,
  deck: Omit<SlideDeck, 'id' | 'workshopId'>,
): Promise<SlideDeck> {
  const full: SlideDeck = {
    ...deck,
    name: normalizeTitle(deck.name, 'Untitled deck'),
    id: newId(),
    workshopId,
  }
  await db.transaction('rw', db.workshops, db.slideDecks, db.sounds, async () => {
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new WorkshopNotFoundError()
    if (w.slideDeckIds.length >= LIMITS.maxDecks) {
      throw new MediaLimitError(
        `A workshop can have up to ${LIMITS.maxDecks} slide decks. Delete one first.`,
      )
    }
    if (full.slides.length > LIMITS.maxSlidesPerDeck) {
      throw new MediaLimitError(`A slide deck can have up to ${LIMITS.maxSlidesPerDeck} slides.`)
    }
    const existing = (await listSlideDecks(db, w)).reduce((sum, d) => sum + d.slides.length, 0)
    if (existing + full.slides.length > LIMITS.maxSlidesTotal) {
      throw new MediaLimitError(
        `A workshop can have up to ${LIMITS.maxSlidesTotal} slides. Delete a deck first.`,
      )
    }
    const added = full.slides.reduce((sum, s) => sum + s.size, 0)
    if ((await mediaBytes(db, w)) + added > LIMITS.maxMediaBytes) throw mediaLimitError()
    await db.slideDecks.add(full)
    await saveWorkshop(db, { ...w, slideDeckIds: [...w.slideDeckIds, full.id] })
  })
  return full
}

/** Renames a slide deck. */
export async function renameSlideDeck(db: PlanOnMeDB, deckId: string, name: string): Promise<void> {
  await db.transaction('rw', db.slideDecks, async () => {
    const deck = normalizeSlideDeck(await db.slideDecks.get(deckId))
    if (!deck) throw new DeckNotFoundError()
    await db.slideDecks.put({ ...deck, name: normalizeTitle(name, 'Untitled deck') })
  })
}

/** Deletes a slide deck and removes it from its workshop. */
export async function deleteSlideDeck(
  db: PlanOnMeDB,
  workshopId: string,
  deckId: string,
): Promise<void> {
  await db.transaction('rw', db.workshops, db.slideDecks, async () => {
    const row: unknown = await db.slideDecks.get(deckId)
    const deck = normalizeSlideDeck(row)
    if (deck && deck.workshopId !== workshopId) throw new DeckNotFoundError()
    await db.slideDecks.delete(deckId)
    const w = await getWorkshop(db, workshopId)
    if (w && w.slideDeckIds.includes(deckId)) {
      await saveWorkshop(db, { ...w, slideDeckIds: w.slideDeckIds.filter((id) => id !== deckId) })
    }
  })
}

/**
 * Moves a slide deck up (negative delta) or down (positive delta) in its workshop. Returns the
 * new order of deck ids. Ids of decks that no longer exist are dropped on the way.
 */
export async function moveSlideDeck(
  db: PlanOnMeDB,
  workshopId: string,
  deckId: string,
  delta: number,
): Promise<string[]> {
  return db.transaction('rw', db.workshops, db.slideDecks, async () => {
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new WorkshopNotFoundError()
    const ids = (await listSlideDecks(db, w)).map((d) => d.id)
    const from = ids.indexOf(deckId)
    if (from === -1) throw new DeckNotFoundError()
    const to = Math.min(ids.length - 1, Math.max(0, from + Math.trunc(delta)))
    ids.splice(to, 0, ...ids.splice(from, 1))
    const saved = await saveWorkshop(db, { ...w, slideDeckIds: ids })
    return saved.slideDeckIds
  })
}

/**
 * A sound name that works inside a cue such as [SFX name]: square brackets become round ones,
 * and runs of spaces become one space.
 */
export function cleanSoundName(name: string): string {
  return normalizeTitle(
    name.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' '),
    'Untitled sound',
  )
}

/** The name, or the name with a number added, so that no other sound has it. */
export function uniqueSoundName(name: string, others: readonly { name: string }[]): string {
  const taken = new Set(others.map((s) => soundKey(s.name)))
  if (!taken.has(soundKey(name))) return name
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`
    const candidate = name.slice(0, LIMITS.maxTitleLength - suffix.length) + suffix
    if (!taken.has(soundKey(candidate))) return candidate
  }
}

/** Sound settings that can change after upload. */
export type SoundPatch = Partial<
  Pick<Sound, 'name' | 'kind' | 'loop' | 'volume' | 'hotkey' | 'color'>
>

/** Checks and cleans sound settings. Throws SoundSettingsError with a readable message. */
function cleanPatch(
  patch: SoundPatch,
  others: readonly Sound[],
  selfId: string | null,
): SoundPatch {
  const out: SoundPatch = {}
  if (patch.name !== undefined) out.name = cleanSoundName(patch.name)
  if (patch.kind !== undefined) {
    if (!SOUND_KINDS.includes(patch.kind)) throw new SoundSettingsError('Pick music or effect.')
    out.kind = patch.kind
  }
  if (patch.loop !== undefined) out.loop = patch.loop === true
  if (patch.volume !== undefined) {
    if (typeof patch.volume !== 'number' || !Number.isFinite(patch.volume)) {
      throw new SoundSettingsError('Volume must be a number.')
    }
    out.volume = Math.min(1, Math.max(0, patch.volume))
  }
  if (patch.color !== undefined) {
    if (patch.color !== '' && !COLOR_PATTERN.test(patch.color)) {
      throw new SoundSettingsError('Color must look like #ff8800.')
    }
    out.color = patch.color.toLowerCase()
  }
  if (patch.hotkey !== undefined) {
    const problem = hotkeyProblem(patch.hotkey, others, selfId)
    if (problem) throw new SoundSettingsError(problem)
    out.hotkey = patch.hotkey === '' ? '' : hotkeyFromKey(patch.hotkey)
  }
  return out
}

/**
 * Adds a sound to a workshop. The name gets a number added if another sound has it. Throws
 * MediaLimitError when the file or the workshop is too big, and SoundSettingsError for a bad
 * setting such as a hotkey that is taken.
 */
export async function addSound(
  db: PlanOnMeDB,
  workshopId: string,
  sound: Omit<Sound, 'id' | 'workshopId'>,
): Promise<Sound> {
  if (!(sound.blob instanceof Blob)) throw new SoundSettingsError('The sound has no audio data.')
  if (!isAudioType(sound.blob.type)) {
    throw new SoundSettingsError('The file type must be an audio type such as audio/mpeg.')
  }
  if (sound.blob.size > LIMITS.maxSoundBytes) {
    throw new MediaLimitError(
      `A sound can be up to ${Math.round(LIMITS.maxSoundBytes / MB)} MB. This file is larger.`,
    )
  }
  return db.transaction('rw', db.workshops, db.sounds, db.slideDecks, async () => {
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new WorkshopNotFoundError()
    if (w.soundIds.length >= LIMITS.maxSounds) {
      throw new MediaLimitError(
        `A workshop can have up to ${LIMITS.maxSounds} sounds. Delete one first.`,
      )
    }
    const others = await listSounds(db, w)
    if (others.length >= LIMITS.maxSounds) {
      throw new MediaLimitError(
        `A workshop can have up to ${LIMITS.maxSounds} sounds. Delete one first.`,
      )
    }
    const used = others.reduce((sum, s) => sum + s.blob.size, 0)
    if (used + sound.blob.size > LIMITS.maxSoundBytesTotal) {
      throw new MediaLimitError(
        `A workshop can hold up to ${Math.round(LIMITS.maxSoundBytesTotal / MB)} MB of sounds. Delete one first.`,
      )
    }
    if ((await mediaBytes(db, w)) + sound.blob.size > LIMITS.maxMediaBytes) throw mediaLimitError()
    const clean = cleanPatch(sound, others, null)
    const full: Sound = {
      id: newId(),
      workshopId,
      name: uniqueSoundName(clean.name ?? 'Untitled sound', others),
      kind: clean.kind ?? 'sfx',
      blob: sound.blob,
      loop: clean.loop ?? false,
      volume: clean.volume ?? 1,
      hotkey: clean.hotkey ?? '',
      color: clean.color ?? '',
    }
    await db.sounds.add(full)
    await saveWorkshop(db, { ...w, soundIds: [...w.soundIds, full.id] })
    return full
  })
}

/** Changes the settings of a sound in a workshop and returns the saved sound. */
export async function updateSound(
  db: PlanOnMeDB,
  workshopId: string,
  soundId: string,
  patch: SoundPatch,
): Promise<Sound> {
  return db.transaction('rw', db.workshops, db.sounds, async () => {
    const sound = normalizeSound(await db.sounds.get(soundId))
    if (!sound || sound.workshopId !== workshopId) throw new SoundNotFoundError()
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new WorkshopNotFoundError()
    const others = (await listSounds(db, w)).filter((s) => s.id !== soundId)
    const clean = cleanPatch(patch, others, soundId)
    if (
      clean.name !== undefined &&
      others.some((s) => soundKey(s.name) === soundKey(clean.name ?? ''))
    ) {
      throw new SoundSettingsError(`Another sound is already called "${clean.name}".`)
    }
    const saved: Sound = { ...sound, ...clean }
    await db.sounds.put(saved)
    return saved
  })
}

/** Deletes a sound and removes it from its workshop. */
export async function deleteSound(
  db: PlanOnMeDB,
  workshopId: string,
  soundId: string,
): Promise<void> {
  await db.transaction('rw', db.workshops, db.sounds, async () => {
    const sound = normalizeSound(await db.sounds.get(soundId))
    if (sound && sound.workshopId !== workshopId) throw new SoundNotFoundError()
    await db.sounds.delete(soundId)
    const w = await getWorkshop(db, workshopId)
    if (w && w.soundIds.includes(soundId)) {
      await saveWorkshop(db, { ...w, soundIds: w.soundIds.filter((id) => id !== soundId) })
    }
  })
}

export async function getCurrentWorkshopId(db: PlanOnMeDB): Promise<string | null> {
  const row = await db.meta.get(CURRENT_KEY)
  const value = row?.value
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.maxIdLength
    ? value
    : null
}

export async function setCurrentWorkshopId(db: PlanOnMeDB, id: string | null): Promise<void> {
  if (id === null) await db.meta.delete(CURRENT_KEY)
  else await db.meta.put({ key: CURRENT_KEY, value: id })
}
