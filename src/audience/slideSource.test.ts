// @vitest-environment node
import { PlanOnMeDB } from '../db/db'
import { addSlideDeck, createWorkshop } from '../db/repo'
import { fakePngBytes } from '../test/media'
import { createSlideSource, SlideMissingError } from './slideSource'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`audience-test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

function png(extra: number): Blob {
  return new Blob([fakePngBytes(extra)], { type: 'image/png' })
}

test('reads slides of a deck from the database', async () => {
  const w = await createWorkshop(db, 'W')
  const deck = await addSlideDeck(db, w.id, { name: 'D', source: 'pdf', slides: [png(1), png(2)] })
  const load = createSlideSource(() => db)
  expect((await load(deck.id, 0)).size).toBe(9)
  expect((await load(deck.id, 1)).size).toBe(10)
  await expect(load(deck.id, 2)).rejects.toBeInstanceOf(SlideMissingError)
  await expect(load('nope', 0)).rejects.toBeInstanceOf(SlideMissingError)
})

test('rejects stored records that are not usable slides', async () => {
  await db.slideDecks.put({
    id: 'junk',
    workshopId: 'w',
    name: 'J',
    source: 'pdf',
    slides: [new Blob(['<html>'], { type: 'text/html' })],
  })
  await db.slideDecks.put({ id: 'odd', slides: 'not a list' } as never)
  const load = createSlideSource(() => db)
  await expect(load('junk', 0)).rejects.toThrow(/not usable/)
  await expect(load('odd', 0)).rejects.toBeInstanceOf(SlideMissingError)
})
