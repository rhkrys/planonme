import type { PlanOnMeDB } from './db'
import { newId } from './ids'
import { LIMITS } from './limits'
import { normalizeSlideDeck, normalizeSound, normalizeTitle, normalizeWorkshop } from './normalize'
import type { SlideDeck, Sound, Workshop, WorkshopSummary } from './types'

const CURRENT_KEY = 'currentWorkshopId'

/** The workshop is gone, for example because another tab deleted it. */
export class WorkshopNotFoundError extends Error {
  constructor() {
    super('This workshop no longer exists. It may have been deleted in another tab.')
    this.name = 'WorkshopNotFoundError'
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
  const clean = normalizeWorkshop({ ...workshop, updatedAt: Date.now() })
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

function orderById<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...items].sort((a, b) => rank(a.id) - rank(b.id))
}

/** Adds a slide deck to a workshop. */
export async function addSlideDeck(
  db: PlanOnMeDB,
  workshopId: string,
  deck: Omit<SlideDeck, 'id' | 'workshopId'>,
): Promise<SlideDeck> {
  const full: SlideDeck = { ...deck, id: newId(), workshopId }
  await db.transaction('rw', db.workshops, db.slideDecks, async () => {
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new Error('Workshop not found')
    if (w.slideDeckIds.length >= LIMITS.maxDecks) throw new Error('Too many slide decks')
    await db.slideDecks.add(full)
    await saveWorkshop(db, { ...w, slideDeckIds: [...w.slideDeckIds, full.id] })
  })
  return full
}

/** Adds a sound to a workshop. */
export async function addSound(
  db: PlanOnMeDB,
  workshopId: string,
  sound: Omit<Sound, 'id' | 'workshopId'>,
): Promise<Sound> {
  const full: Sound = { ...sound, id: newId(), workshopId }
  await db.transaction('rw', db.workshops, db.sounds, async () => {
    const w = await getWorkshop(db, workshopId)
    if (!w) throw new Error('Workshop not found')
    if (w.soundIds.length >= LIMITS.maxSounds) throw new Error('Too many sounds')
    await db.sounds.add(full)
    await saveWorkshop(db, { ...w, soundIds: [...w.soundIds, full.id] })
  })
  return full
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
