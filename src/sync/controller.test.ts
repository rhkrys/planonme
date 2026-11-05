import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MediaSummary } from '../db/repo'
import type { Workshop } from '../db/types'
import { createAudienceStore, type AudienceState } from '../store/audienceStore'
import type { WorkshopState } from '../store/workshopStore'
import { createFakeBus, last } from '../test/fakeChannel'
import {
  ADOPT_WAIT_MS,
  HEARTBEAT_MS,
  readSaved,
  startAudienceSync,
  STORAGE_KEY,
  TIMEOUT_MS,
} from './controller'
import type { AudienceScreen, SyncMessage } from './protocol'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

function workshop(id: string, title = 'Kick off'): Workshop {
  return {
    id,
    title,
    date: '',
    durationMin: 60,
    blocks: [],
    slideDeckIds: [],
    soundIds: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function media(...decks: [string, number][]): MediaSummary {
  return { decks: decks.map(([id, slideCount]) => ({ id, name: id, slideCount })), sounds: [] }
}

function setup(options: { storage?: Storage; ready?: boolean } = {}) {
  const ws = createStore(() => ({
    status: options.ready === false ? 'loading' : 'ready',
    current: options.ready === false ? null : workshop('w1'),
    media: options.ready === false ? null : media(['a', 2], ['b', 2]),
  })) as unknown as StoreApi<WorkshopState>
  const audience: StoreApi<AudienceState> = createAudienceStore(
    () => ws.getState().media?.decks ?? [],
  )
  const bus = createFakeBus()
  const control = bus.endpoint()
  const window = bus.endpoint()
  const received: SyncMessage[] = []
  window.listen((m) => received.push(m))
  const storage = options.storage ?? memoryStorage()
  const stop = startAudienceSync({ channel: control, audience, workshop: ws, storage })
  const shows = () =>
    received.flatMap((m) => (m.from === 'control' && m.type === 'show' ? [m.screen] : []))
  return { ws, audience, bus, control, window, received, shows, storage, stop }
}

const slide = (deckId: string, index: number, number: number): AudienceScreen => ({
  mode: 'slide',
  deckId,
  index,
  number,
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const settle = () => vi.advanceTimersByTimeAsync(0)

test('a fresh control window waits briefly, then shows the first slide', async () => {
  const t = setup()
  await settle()
  expect(t.received).toEqual([{ v: 1, from: 'control', type: 'hello' }])
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  expect(t.shows()).toEqual([slide('a', 0, 1)])
  t.stop()
})

test('slide changes, blank and logo go to the audience window and are remembered', async () => {
  const t = setup()
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  t.audience.getState().step(1)
  t.audience.getState().step(1)
  t.audience.getState().toggleBlank()
  t.audience.getState().toggleLogo()
  await settle()
  expect(t.shows()).toEqual([
    slide('a', 0, 1),
    slide('a', 1, 2),
    slide('b', 0, 3),
    { mode: 'blank' },
    { mode: 'logo', title: 'Kick off' },
  ])
  expect(readSaved(t.storage)).toEqual({
    workshopId: 'w1',
    slide: { deckId: 'b', index: 0 },
    overlay: 'logo',
  })
  t.stop()
})

test('answers a new audience window and resends when it shows something else', async () => {
  const t = setup()
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  t.received.length = 0
  t.window.post({ v: 1, from: 'audience', type: 'hello' })
  await settle()
  expect(t.shows()).toEqual([slide('a', 0, 1)])
  t.window.post({
    v: 1,
    from: 'audience',
    type: 'status',
    screen: { mode: 'blank' },
    problem: null,
  })
  await settle()
  expect(t.shows()).toEqual([slide('a', 0, 1), slide('a', 0, 1)])
  // A matching status needs no resend.
  t.window.post({ v: 1, from: 'audience', type: 'status', screen: slide('a', 0, 1), problem: null })
  await settle()
  expect(t.shows()).toHaveLength(2)
  t.stop()
})

test('a fresh control window takes over what an open audience window shows', async () => {
  const t = setup()
  t.window.listen((m) => {
    if (m.from === 'control' && m.type === 'hello') {
      t.window.post({
        v: 1,
        from: 'audience',
        type: 'status',
        screen: slide('b', 1, 4),
        problem: null,
      })
    }
  })
  // The hello was sent before this listener existed, so ask again.
  t.control.post({ v: 1, from: 'control', type: 'hello' })
  await settle()
  expect(t.audience.getState().slide).toEqual({ deckId: 'b', index: 1 })
  expect(t.audience.getState().connected).toBe(true)
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  expect(t.shows()).toEqual([slide('b', 1, 4)])
  t.stop()
})

test('a reloaded control window restores its slide right away', async () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      workshopId: 'w1',
      slide: { deckId: 'b', index: 0 },
      overlay: 'none',
    }),
  })
  const t = setup({ storage })
  await settle()
  expect(t.shows()).toEqual([slide('b', 0, 3)])
  t.stop()
})

test('saved state from another workshop or junk falls back to the first slide', async () => {
  for (const raw of [
    JSON.stringify({ workshopId: 'other', slide: { deckId: 'b', index: 0 }, overlay: 'none' }),
    '{not json',
    JSON.stringify({ workshopId: 5, slide: { deckId: 'b', index: -3 }, overlay: 'weird' }),
    JSON.stringify([1, 2]),
  ]) {
    const t = setup({ storage: memoryStorage({ [STORAGE_KEY]: raw }) })
    await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
    expect(t.shows()).toEqual([slide('a', 0, 1)])
    t.stop()
  }
})

test('waits for the workshop to load before sending anything', async () => {
  const t = setup({ ready: false })
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS * 2)
  expect(t.shows()).toEqual([])
  t.ws.setState({ status: 'ready', current: workshop('w1'), media: media(['a', 1]) })
  await settle()
  expect(t.shows()).toEqual([slide('a', 0, 1)])
  t.stop()
})

test('keeps the slide valid when decks or the workshop change', async () => {
  const t = setup()
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  t.audience.getState().showSlide({ deckId: 'b', index: 1 })
  t.ws.setState({ media: media(['a', 2], ['b', 1]) })
  expect(t.audience.getState().slide).toEqual({ deckId: 'b', index: 0 })
  t.ws.setState({ media: media(['a', 2]) })
  expect(t.audience.getState().slide).toEqual({ deckId: 'a', index: 0 })
  t.ws.setState({ current: workshop('w2', 'Other'), media: media(['c', 1]) })
  expect(t.audience.getState()).toMatchObject({
    workshopId: 'w2',
    slide: { deckId: 'c', index: 0 },
  })
  t.ws.setState({ current: workshop('w3', 'Empty'), media: media() })
  expect(t.audience.getState().slide).toBeNull()
  await settle()
  expect(last(t.shows())).toEqual({ mode: 'logo', title: 'Empty' })
  t.stop()
})

test('tracks whether an audience window is connected', async () => {
  const t = setup()
  t.window.listen((m) => {
    if (m.from === 'control' && m.type === 'hello') {
      t.window.post({ v: 1, from: 'audience', type: 'status', screen: null, problem: null })
    }
  })
  await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
  expect(t.audience.getState().connected).toBe(true)
  t.window.post({ v: 1, from: 'audience', type: 'bye' })
  await settle()
  expect(t.audience.getState().connected).toBe(false)
  await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
  expect(t.audience.getState().connected).toBe(true)

  // The window goes away without saying bye.
  t.window.close()
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS + HEARTBEAT_MS * 2)
  expect(t.audience.getState().connected).toBe(false)
  t.stop()
})

test('reports the audience window problem and ignores junk', async () => {
  const t = setup()
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  t.bus.inject({ v: 1, from: 'audience', type: 'status', screen: 'slide 1', problem: null })
  t.bus.inject('hello')
  t.bus.inject(null)
  await settle()
  expect(t.audience.getState().connected).toBe(false)
  t.window.post({
    v: 1,
    from: 'audience',
    type: 'status',
    screen: slide('a', 0, 1),
    problem: 'missing',
  })
  await settle()
  expect(t.audience.getState()).toMatchObject({ connected: true, problem: 'missing' })
  t.stop()
})

test('works without a channel', async () => {
  const ws = createStore(() => ({
    status: 'ready',
    current: workshop('w1'),
    media: media(['a', 1]),
  })) as unknown as StoreApi<WorkshopState>
  const audience = createAudienceStore(() => ws.getState().media?.decks ?? [])
  const stop = startAudienceSync({ channel: null, audience, workshop: ws, storage: null })
  await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
  audience.getState().step(1)
  expect(audience.getState().slide).toEqual({ deckId: 'a', index: 0 })
  stop()
})

test('storage that throws does not break anything', async () => {
  const broken = memoryStorage()
  broken.getItem = () => {
    throw new Error('blocked')
  }
  broken.setItem = () => {
    throw new Error('full')
  }
  const t = setup({ storage: broken })
  await vi.advanceTimersByTimeAsync(ADOPT_WAIT_MS)
  t.audience.getState().step(1)
  await settle()
  expect(t.shows()).toEqual([slide('a', 0, 1), slide('a', 1, 2)])
  t.stop()
})

test('two control windows do not fight over the audience window', async () => {
  const ws = (id: string) =>
    createStore(() => ({
      status: 'ready',
      current: workshop('w1'),
      media: media(['a', 3]),
      id,
    })) as unknown as StoreApi<WorkshopState>
  const bus = createFakeBus()
  const saved = (index: number) =>
    memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        workshopId: 'w1',
        slide: { deckId: 'a', index },
        overlay: 'none',
      }),
    })
  const wsA = ws('A')
  const wsB = ws('B')
  const audA = createAudienceStore(() => wsA.getState().media?.decks ?? [])
  const audB = createAudienceStore(() => wsB.getState().media?.decks ?? [])
  const stopA = startAudienceSync({
    channel: bus.endpoint(),
    audience: audA,
    workshop: wsA,
    storage: saved(0),
  })
  const stopB = startAudienceSync({
    channel: bus.endpoint(),
    audience: audB,
    workshop: wsB,
    storage: saved(1),
  })
  // A stand-in audience window that answers every show with a status, as the real one does.
  const win = bus.endpoint()
  let shows = 0
  let current: AudienceScreen | null = null
  win.listen((m) => {
    if (m.from !== 'control') return
    if (m.type === 'show') {
      shows++
      if (shows > 200) return
      current = m.screen
    }
    win.post({ v: 1, from: 'audience', type: 'status', screen: current, problem: null })
  })
  win.post({ v: 1, from: 'audience', type: 'hello' })
  for (let i = 0; i < 20; i++) await settle()
  expect(shows).toBeLessThan(10)
  // The window where the user acts last wins.
  audA.getState().step(1)
  for (let i = 0; i < 20; i++) await settle()
  expect(current).toEqual(slide('a', 1, 2))
  audB.getState().step(1)
  for (let i = 0; i < 20; i++) await settle()
  expect(current).toEqual(slide('a', 2, 3))
  expect(shows).toBeLessThan(20)
  stopA()
  stopB()
})
