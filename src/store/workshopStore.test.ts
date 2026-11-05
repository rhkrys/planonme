// @vitest-environment node
import { BACKUP_FORMAT } from '../db/backup'
import { PlanOnMeDB } from '../db/db'
import { addSlideDeck, addSound } from '../db/repo'
import { fakePngBytes, makeWav } from '../test/media'
import { createWorkshopStore, FIRST_WORKSHOP_TITLE } from './workshopStore'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`store-test-${++n}`)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
})

function makeStore() {
  return createWorkshopStore(() => db)
}

test('first start creates a workshop and selects it', async () => {
  const store = makeStore()
  await store.getState().init()
  const s = store.getState()
  expect(s.status).toBe('ready')
  expect(s.workshops.map((w) => w.title)).toEqual([FIRST_WORKSHOP_TITLE])
  expect(s.current?.id).toBe(s.currentId)
})

test('create, select, rename and delete, and remember the current one across reloads', async () => {
  const store = makeStore()
  await store.getState().init()
  await store.getState().createWorkshop('Second')
  const second = store.getState().current
  expect(second?.title).toBe('Second')

  // A fresh store, like a page reload, opens the same workshop.
  const reloaded = makeStore()
  await reloaded.getState().init()
  expect(reloaded.getState().currentId).toBe(second?.id)

  await reloaded.getState().renameWorkshop(second?.id ?? '', 'Renamed')
  expect(reloaded.getState().current?.title).toBe('Renamed')
  expect(reloaded.getState().workshops.map((w) => w.title)).toContain('Renamed')

  const first = reloaded.getState().workshops.find((w) => w.title === FIRST_WORKSHOP_TITLE)
  await reloaded.getState().selectWorkshop(first?.id ?? '')
  expect(reloaded.getState().current?.title).toBe(FIRST_WORKSHOP_TITLE)

  await reloaded.getState().deleteWorkshop(first?.id ?? '')
  expect(reloaded.getState().workshops.map((w) => w.title)).toEqual(['Renamed'])
  expect(reloaded.getState().current?.title).toBe('Renamed')

  await reloaded.getState().deleteWorkshop(second?.id ?? '')
  expect(reloaded.getState().workshops).toEqual([])
  expect(reloaded.getState().current).toBeNull()
  expect(reloaded.getState().error).toBeNull()
})

test('selecting a missing workshop falls back to the first', async () => {
  const store = makeStore()
  await store.getState().init()
  await store.getState().selectWorkshop('nope')
  expect(store.getState().current?.title).toBe(FIRST_WORKSHOP_TITLE)
})

test('updateCurrent saves and keeps the list in sync', async () => {
  const store = makeStore()
  await store.getState().init()
  await store.getState().updateCurrent({ title: 'New title', durationMin: 45 })
  expect(store.getState().current?.durationMin).toBe(45)
  expect(store.getState().workshops[0]?.title).toBe('New title')
  const reloaded = makeStore()
  await reloaded.getState().init()
  expect(reloaded.getState().current?.durationMin).toBe(45)
})

test('export and import through the store', async () => {
  const store = makeStore()
  await store.getState().init()
  const file = await store.getState().exportCurrent()
  expect(file).not.toBeNull()
  if (!file) return
  expect(await store.getState().importFile(file.blob)).toBe(true)
  const s = store.getState()
  expect(s.workshops).toHaveLength(2)
  expect(s.current?.title).toBe(`${FIRST_WORKSHOP_TITLE} (2)`)
  expect(s.notice).toMatch(/Imported/)
})

test('a bad import shows a readable error and keeps the state', async () => {
  const store = makeStore()
  await store.getState().init()
  const before = store.getState().workshops
  const bad = new Blob([JSON.stringify({ format: BACKUP_FORMAT, version: 99 })])
  expect(await store.getState().importFile(bad)).toBe(false)
  expect(store.getState().error).toMatch(/newer version/)
  expect(store.getState().workshops).toEqual(before)
  store.getState().clearMessages()
  expect(store.getState().error).toBeNull()
})

test('storage failure on start shows an error instead of crashing', async () => {
  const store = createWorkshopStore(() => {
    throw new Error('IndexedDB blocked')
  })
  await store.getState().init()
  expect(store.getState().status).toBe('error')
  expect(store.getState().error).toMatch(/Could not open saved workshops/)
})

test('rapid updates are all kept, in order', async () => {
  const store = makeStore()
  await store.getState().init()
  const id = store.getState().currentId
  await Promise.all([
    store.getState().updateCurrent({ title: 'New title' }),
    store.getState().updateCurrent({ durationMin: 99 }),
    store.getState().updateCurrent({ date: '2025-05-01' }),
  ])
  const stored = await db.workshops.get(id ?? '')
  expect(stored?.title).toBe('New title')
  expect(stored?.durationMin).toBe(99)
  expect(stored?.date).toBe('2025-05-01')
  expect(store.getState().current?.title).toBe('New title')
  expect(store.getState().workshops.map((w) => w.title)).toEqual(['New title'])
})

test('saving a workshop deleted in another tab does not bring it back', async () => {
  const store = makeStore()
  await store.getState().init()
  await store.getState().createWorkshop('Other')
  const id = store.getState().currentId ?? ''
  // Another tab deletes it behind this store's back.
  await db.workshops.delete(id)
  await store.getState().updateCurrent({ durationMin: 30 })
  expect(await db.workshops.get(id)).toBeUndefined()
  expect(store.getState().error).toMatch(/no longer exists/)
  expect(store.getState().current?.title).toBe(FIRST_WORKSHOP_TITLE)
})

test('counts saves that are still being written', async () => {
  const store = makeStore()
  await store.getState().init()
  expect(store.getState().pendingSaves).toBe(0)
  const first = store.getState().updateCurrent({ durationMin: 30 })
  const second = store.getState().updateCurrent({ durationMin: 45 })
  expect(store.getState().pendingSaves).toBe(2)
  await Promise.all([first, second])
  expect(store.getState().pendingSaves).toBe(0)
  expect(store.getState().current?.durationMin).toBe(45)
})

test('an edit queued behind a rename keeps the new name and the edit', async () => {
  const store = makeStore()
  await store.getState().init()
  const id = store.getState().currentId
  if (!id) throw new Error('no current workshop')
  const rename = store.getState().renameWorkshop(id, 'Renamed')
  const edit = store.getState().updateCurrent({ durationMin: 90 })
  await Promise.all([rename, edit])
  expect(store.getState().current?.title).toBe('Renamed')
  expect(store.getState().current?.durationMin).toBe(90)

  const reloaded = makeStore()
  await reloaded.getState().init()
  expect(reloaded.getState().current?.title).toBe('Renamed')
  expect(reloaded.getState().current?.durationMin).toBe(90)
})

test('loads slide and sound names for the current workshop', async () => {
  const store = makeStore()
  await store.getState().init()
  const id = store.getState().currentId
  if (!id) throw new Error('no workshop')
  expect(store.getState().media).toEqual({ decks: [], sounds: [] })

  const png = new Blob([fakePngBytes()], { type: 'image/png' })
  await addSlideDeck(db, id, { name: 'Intro', source: 'pdf', slides: [png, png, png] })
  await addSound(db, id, {
    name: 'Ding',
    kind: 'sfx',
    blob: new Blob([makeWav()], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
  })
  await store.getState().refreshMedia()
  expect(store.getState().media).toMatchObject({
    decks: [{ name: 'Intro', slideCount: 3 }],
    sounds: [{ name: 'Ding', kind: 'sfx' }],
  })

  // A new workshop starts with no media.
  await store.getState().createWorkshop('Other')
  expect(store.getState().media).toEqual({ decks: [], sounds: [] })
})

test('a media read failure does not block the workshop', async () => {
  const store = makeStore()
  await store.getState().init()
  vi.spyOn(db.slideDecks, 'where').mockImplementation(() => {
    throw new Error('broken')
  })
  await store.getState().createWorkshop('Still works')
  expect(store.getState().current?.title).toBe('Still works')
  expect(store.getState().media).toBeNull()
  expect(store.getState().error).toBeNull()
})

test('slide deck actions keep current, media and the deck list in step', async () => {
  const store = makeStore()
  await store.getState().init()
  const id = store.getState().currentId ?? ''
  const png = () => new Blob([fakePngBytes()], { type: 'image/png' })

  expect(
    await store.getState().addSlideDeck(id, { name: 'A', source: 'pdf', slides: [png()] }),
  ).toBe(true)
  expect(store.getState().notice).toBe('Added "A" with 1 slide.')
  expect(
    await store
      .getState()
      .addSlideDeck(id, { name: 'B', source: 'gslides', slides: [png(), png()] }),
  ).toBe(true)
  expect(store.getState().media?.decks.map((d) => [d.name, d.slideCount])).toEqual([
    ['A', 1],
    ['B', 2],
  ])
  const [a, b] = store.getState().media?.decks ?? []

  expect(await store.getState().moveSlideDeck(b?.id ?? '', -1)).toBe(true)
  expect(store.getState().current?.slideDeckIds).toEqual([b?.id, a?.id])
  expect(store.getState().media?.decks.map((d) => d.name)).toEqual(['B', 'A'])
  expect((await store.getState().loadSlideDecks())?.map((d) => d.slides.length)).toEqual([2, 1])

  // A block edit made meanwhile is kept.
  const edit = store.getState().updateCurrent({ title: 'Edited' })
  expect(await store.getState().renameSlideDeck(a?.id ?? '', 'Alpha')).toBe(true)
  await edit
  expect(store.getState().current?.title).toBe('Edited')
  expect(store.getState().media?.decks.map((d) => d.name)).toEqual(['B', 'Alpha'])

  expect(await store.getState().deleteSlideDeck(b?.id ?? '')).toBe(true)
  expect(store.getState().current?.slideDeckIds).toEqual([a?.id])
  expect(store.getState().media?.decks.map((d) => d.name)).toEqual(['Alpha'])

  expect(await store.getState().renameSlideDeck('missing', 'X')).toBe(false)
  expect(store.getState().error).toMatch(/no longer exists/)
})

test('adding a deck to a workshop that is no longer current leaves the current one alone', async () => {
  const store = makeStore()
  await store.getState().init()
  const first = store.getState().currentId ?? ''
  await store.getState().createWorkshop('Other')
  const png = new Blob([fakePngBytes()], { type: 'image/png' })
  expect(
    await store.getState().addSlideDeck(first, { name: 'A', source: 'pdf', slides: [png] }),
  ).toBe(true)
  expect(store.getState().media?.decks).toEqual([])
  await store.getState().selectWorkshop(first)
  expect(store.getState().media?.decks.map((d) => d.name)).toEqual(['A'])
})

test('sound actions keep current, media and the sound list in step', async () => {
  const store = makeStore()
  await store.getState().init()
  const id = store.getState().currentId
  if (!id) throw new Error('no workshop')
  // An unsaved edit must survive sound changes.
  void store.getState().updateCurrent({ title: 'Edited' })

  const wav = () => new Blob([makeWav()], { type: 'audio/wav' })
  const base = { kind: 'sfx' as const, loop: false, volume: 1, hotkey: '', color: '' }
  const a = await store.getState().addSound(id, { ...base, name: 'Applause', blob: wav() })
  expect(a?.name).toBe('Applause')
  expect(store.getState().notice).toBe('Added "Applause".')
  const b = await store.getState().addSound(id, { ...base, name: 'Gong', blob: wav() })
  if (!a || !b) throw new Error('not added')
  expect(store.getState().current?.soundIds).toEqual([a.id, b.id])
  expect(store.getState().current?.title).toBe('Edited')
  expect(store.getState().media?.sounds.map((s) => s.name)).toEqual(['Applause', 'Gong'])

  expect(await store.getState().updateSound(b.id, { name: 'Bell', kind: 'music' })).toBe(true)
  expect(store.getState().media?.sounds[1]).toEqual({ id: b.id, name: 'Bell', kind: 'music' })
  expect((await store.getState().loadSounds())?.map((s) => s.name)).toEqual(['Applause', 'Bell'])

  expect(await store.getState().updateSound(b.id, { hotkey: 'b' })).toBe(false)
  expect(store.getState().error).toBe('B is kept for the blank screen.')

  expect(await store.getState().deleteSound(a.id)).toBe(true)
  expect(store.getState().current?.soundIds).toEqual([b.id])
  expect(store.getState().media?.sounds.map((s) => s.name)).toEqual(['Bell'])
  expect(store.getState().error).toBeNull()

  expect(await store.getState().addSound('missing', { ...base, name: 'X', blob: wav() })).toBeNull()
  expect(store.getState().error).toMatch(/no longer exists/)
})
