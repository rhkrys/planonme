// @vitest-environment node
import { fakePngBytes, makeWav } from '../test/media'
import { PlanOnMeDB } from './db'
import {
  addSlideDeck,
  addSound,
  createWorkshop,
  deleteWorkshop,
  getCurrentWorkshopId,
  getWorkshop,
  listSlideDecks,
  listSounds,
  listWorkshops,
  renameWorkshop,
  saveWorkshop,
  setCurrentWorkshopId,
} from './repo'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`repo-test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

test('creates, lists, renames and saves workshops', async () => {
  const b = await createWorkshop(db, 'Beta')
  const a = await createWorkshop(db, '  Alpha  ')
  expect((await listWorkshops(db)).map((w) => w.title)).toEqual(['Alpha', 'Beta'])

  await renameWorkshop(db, b.id, 'Gamma')
  expect((await getWorkshop(db, b.id))?.title).toBe('Gamma')

  const saved = await saveWorkshop(db, {
    ...a,
    durationMin: 90,
    blocks: [
      {
        id: 'b1',
        title: 'Intro',
        kind: 'talk',
        durationMin: 10,
        goal: '',
        notes: '',
        script: '[SLIDE 1]',
      },
    ],
  })
  expect(saved.updatedAt).toBeGreaterThanOrEqual(a.updatedAt)
  expect((await getWorkshop(db, a.id))?.blocks).toHaveLength(1)
})

test('deleting a workshop removes its decks and sounds only', async () => {
  const keep = await createWorkshop(db, 'Keep')
  const drop = await createWorkshop(db, 'Drop')
  const png = new Blob([fakePngBytes()], { type: 'image/png' })
  const wav = new Blob([makeWav()], { type: 'audio/wav' })
  const sound = {
    name: 'Ding',
    kind: 'sfx' as const,
    blob: wav,
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
  }
  await addSlideDeck(db, keep.id, { name: 'Deck', source: 'pdf', slides: [png] })
  await addSlideDeck(db, drop.id, { name: 'Deck', source: 'pdf', slides: [png] })
  await addSound(db, keep.id, sound)
  await addSound(db, drop.id, sound)

  await deleteWorkshop(db, drop.id)
  expect(await getWorkshop(db, drop.id)).toBeNull()
  expect(await db.slideDecks.count()).toBe(1)
  expect(await db.sounds.count()).toBe(1)
  const kept = await getWorkshop(db, keep.id)
  expect(kept).not.toBeNull()
  if (!kept) return
  expect(await listSlideDecks(db, kept)).toHaveLength(1)
  expect(await listSounds(db, kept)).toHaveLength(1)
})

test('remembers the current workshop id', async () => {
  expect(await getCurrentWorkshopId(db)).toBeNull()
  await setCurrentWorkshopId(db, 'abc')
  expect(await getCurrentWorkshopId(db)).toBe('abc')
  await setCurrentWorkshopId(db, null)
  expect(await getCurrentWorkshopId(db)).toBeNull()
  await db.meta.put({ key: 'currentWorkshopId', value: 42 })
  expect(await getCurrentWorkshopId(db)).toBeNull()
})

test('survives damaged rows in storage', async () => {
  const good = await createWorkshop(db, 'Good')
  // Rows written by something else: wrong types, missing fields, junk blocks.
  await db.workshops.bulkPut([
    { id: 'junk', title: 123, blocks: 'nope', durationMin: Infinity } as never,
    {
      id: 'partial',
      title: '',
      blocks: [null, { id: 'x', kind: 'dance', durationMin: -5 }, { title: 'no id' }],
      slideDeckIds: [1, 'd1', 'd1'],
    } as never,
  ])
  await db.slideDecks.put({
    id: 'd1',
    workshopId: 'partial',
    name: 5,
    slides: ['not a blob'],
  } as never)
  await db.sounds.put({ id: 's1', workshopId: 'partial', name: 'x', blob: 'nope' } as never)

  const list = await listWorkshops(db)
  expect(list.map((w) => w.id).sort()).toEqual([good.id, 'junk', 'partial'].sort())
  const partial = await getWorkshop(db, 'partial')
  expect(partial?.title).toBe('Untitled workshop')
  expect(partial?.blocks).toEqual([
    { id: 'x', title: '', kind: 'talk', durationMin: 0, goal: '', notes: '', script: '' },
  ])
  expect(partial?.slideDeckIds).toEqual(['d1'])
  if (!partial) return
  const decks = await listSlideDecks(db, partial)
  expect(decks).toHaveLength(1)
  expect(decks[0]?.slides).toEqual([])
  expect(await listSounds(db, partial)).toEqual([])
  expect((await getWorkshop(db, 'junk'))?.durationMin).toBe(0)
})
