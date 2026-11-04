import { PlanOnMeDB } from '../db/db'
import { LIMITS, SLIDE_IMAGE_TYPES } from '../db/limits'
import { normalizeSlideDeck } from '../db/normalize'
import type { SlideDeck } from '../db/types'

/** Thrown when a slide is not there (deck deleted, or fewer slides than asked for). */
export class SlideMissingError extends Error {
  constructor() {
    super('Slide not found.')
    this.name = 'SlideMissingError'
  }
}

export type LoadSlide = (deckId: string, index: number) => Promise<Blob>

/** Checks that a stored slide is an image we can show. */
export function checkSlideBlob(blob: Blob): Blob {
  const okType = (SLIDE_IMAGE_TYPES as readonly string[]).includes(blob.type)
  if (!okType || blob.size === 0 || blob.size > LIMITS.maxSlideBytes) {
    throw new Error(`Slide image is not usable (${blob.type || 'no type'}, ${blob.size} bytes).`)
  }
  return blob
}

/**
 * Reads slides from the app's own IndexedDB. The last deck read is kept, so stepping through a
 * deck does not read it again for every slide. Slides of a deck never change after import, so
 * the copy cannot go stale; a deleted deck is simply never asked for again.
 */
export function createSlideSource(getDb: () => PlanOnMeDB = defaultDb): LoadSlide {
  let cached: SlideDeck | null = null
  return async (deckId, index) => {
    if (cached?.id !== deckId || index >= cached.slides.length) {
      const deck = normalizeSlideDeck(await getDb().slideDecks.get(deckId))
      cached = deck
    }
    const blob = cached?.id === deckId ? cached.slides[index] : undefined
    if (!blob) throw new SlideMissingError()
    return checkSlideBlob(blob)
  }
}

let db: PlanOnMeDB | null = null
function defaultDb(): PlanOnMeDB {
  db ??= new PlanOnMeDB()
  return db
}
