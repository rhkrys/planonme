// @vitest-environment node
import { BACKUP_FORMAT } from '../db/backup'
import { PlanOnMeDB } from '../db/db'
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
