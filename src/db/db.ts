import Dexie, { type Table } from 'dexie'
import type { MetaRow, SlideDeck, Sound, Workshop } from './types'

export const DEFAULT_DB_NAME = 'planonme'

/**
 * The browser database. Blocks are embedded in their workshop. Slide decks and sounds live in
 * their own tables (they hold Blobs) and point back with workshopId.
 */
export class PlanOnMeDB extends Dexie {
  declare workshops: Table<Workshop, string>
  declare slideDecks: Table<SlideDeck, string>
  declare sounds: Table<Sound, string>
  declare meta: Table<MetaRow, string>

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name)
    this.version(1).stores({
      workshops: 'id, updatedAt',
      slideDecks: 'id, workshopId',
      sounds: 'id, workshopId',
      meta: 'key',
    })
  }
}
