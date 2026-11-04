// @vitest-environment node
import { fakePngBytes } from '../test/media'
import { PlanOnMeDB } from './db'
import { LIMITS } from './limits'
import {
  addSlideDeck,
  createWorkshop,
  DeckNotFoundError,
  deleteSlideDeck,
  getWorkshop,
  listSlideDecks,
  MediaLimitError,
  moveSlideDeck,
  renameSlideDeck,
  saveWorkshop,
} from './repo'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`deck-test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

function slides(count: number): Blob[] {
  return Array.from({ length: count }, () => new Blob([fakePngBytes()], { type: 'image/png' }))
}

async function names(workshopId: string): Promise<string[]> {
  const w = await getWorkshop(db, workshopId)
  if (!w) throw new Error('no workshop')
  return (await listSlideDecks(db, w)).map((d) => d.name)
}

test('adds, renames, moves and deletes decks', async () => {
  const w = await createWorkshop(db, 'Decks')
  const a = await addSlideDeck(db, w.id, { name: '  A  ', source: 'pdf', slides: slides(2) })
  const b = await addSlideDeck(db, w.id, { name: 'B', source: 'canva', slides: slides(1) })
  const c = await addSlideDeck(db, w.id, { name: 'C', source: 'gamma', slides: slides(1) })
  expect(await names(w.id)).toEqual(['A', 'B', 'C'])

  await renameSlideDeck(db, b.id, '  Bee ')
  expect(await names(w.id)).toEqual(['A', 'Bee', 'C'])

  expect(await moveSlideDeck(db, w.id, c.id, -1)).toEqual([a.id, c.id, b.id])
  expect(await moveSlideDeck(db, w.id, a.id, -1)).toEqual([a.id, c.id, b.id])
  expect(await moveSlideDeck(db, w.id, a.id, 5)).toEqual([c.id, b.id, a.id])
  expect(await names(w.id)).toEqual(['C', 'Bee', 'A'])

  await deleteSlideDeck(db, w.id, b.id)
  expect(await names(w.id)).toEqual(['C', 'A'])
  expect((await getWorkshop(db, w.id))?.slideDeckIds).toEqual([c.id, a.id])
  expect(await db.slideDecks.get(b.id)).toBeUndefined()
  const deck = (await listSlideDecks(db, (await getWorkshop(db, w.id))!))[1]
  expect(deck?.slides).toHaveLength(2)
})

test('deck errors are readable', async () => {
  const w = await createWorkshop(db, 'Errors')
  const other = await createWorkshop(db, 'Other')
  const deck = await addSlideDeck(db, other.id, { name: 'X', source: 'pdf', slides: slides(1) })
  await expect(renameSlideDeck(db, 'missing', 'Y')).rejects.toBeInstanceOf(DeckNotFoundError)
  await expect(moveSlideDeck(db, w.id, 'missing', 1)).rejects.toBeInstanceOf(DeckNotFoundError)
  // A deck of another workshop cannot be deleted through this one.
  await expect(deleteSlideDeck(db, w.id, deck.id)).rejects.toBeInstanceOf(DeckNotFoundError)
  expect(await db.slideDecks.get(deck.id)).toBeDefined()
  // Deleting a deck that is already gone still cleans up the list.
  await saveWorkshop(db, { ...w, slideDeckIds: ['gone'] })
  await deleteSlideDeck(db, w.id, 'gone')
  expect((await getWorkshop(db, w.id))?.slideDeckIds).toEqual([])
})

test('moving drops ids of decks that no longer exist', async () => {
  const w = await createWorkshop(db, 'Stale')
  const a = await addSlideDeck(db, w.id, { name: 'A', source: 'pdf', slides: slides(1) })
  const b = await addSlideDeck(db, w.id, { name: 'B', source: 'pdf', slides: slides(1) })
  const stored = await getWorkshop(db, w.id)
  await saveWorkshop(db, { ...stored!, slideDeckIds: [a.id, 'ghost', b.id] })
  expect(await moveSlideDeck(db, w.id, b.id, -1)).toEqual([b.id, a.id])
})

test('adding a deck respects the slide limits', async () => {
  const w = await createWorkshop(db, 'Limits')
  await expect(
    addSlideDeck(db, w.id, {
      name: 'Big',
      source: 'pdf',
      slides: slides(LIMITS.maxSlidesPerDeck + 1),
    }),
  ).rejects.toBeInstanceOf(MediaLimitError)
  expect(await names(w.id)).toEqual([])
})
