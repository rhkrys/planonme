import { MAX_TICKED_WORKSHOPS, TICKS_KEY, createTickStore, parseTicks } from './ticks'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v)
    },
  }
}

test('ticks are kept per workshop and saved', () => {
  const storage = memoryStorage()
  const store = createTickStore(storage)
  store.getState().setTick('w1', 'zoom-share', true)
  store.getState().setTick('w1', 'zoom-sound', true)
  store.getState().setTick('w1', 'zoom-share', true)
  store.getState().setTick('w2', 'heard-tone', true)
  expect(store.getState().ticks).toEqual({
    w1: ['zoom-share', 'zoom-sound'],
    w2: ['heard-tone'],
  })
  store.getState().setTick('w1', 'zoom-share', false)
  expect(store.getState().ticks.w1).toEqual(['zoom-sound'])

  // A new store (a reload of the tab) reads them back.
  const again = createTickStore(storage)
  expect(again.getState().ticks).toEqual({ w1: ['zoom-sound'], w2: ['heard-tone'] })

  again.getState().clear('w1')
  expect(again.getState().ticks).toEqual({ w2: ['heard-tone'] })
  expect(JSON.parse(storage.data.get(TICKS_KEY) ?? '')).toEqual({ w2: ['heard-tone'] })
})

test('unknown items and empty workshop ids are ignored', () => {
  const store = createTickStore(memoryStorage())
  store.getState().setTick('w1', 'launch-rocket', true)
  store.getState().setTick('', 'zoom-share', true)
  expect(store.getState().ticks).toEqual({})
})

test('unticking the last item drops the workshop', () => {
  const store = createTickStore(memoryStorage())
  store.getState().setTick('w1', 'zoom-share', true)
  store.getState().setTick('w1', 'zoom-share', false)
  expect(store.getState().ticks).toEqual({})
})

test('only the most recent workshops are kept', () => {
  const store = createTickStore(memoryStorage())
  for (let i = 0; i <= MAX_TICKED_WORKSHOPS; i++)
    store.getState().setTick(`w${i}`, 'zoom-share', true)
  const ids = Object.keys(store.getState().ticks)
  expect(ids).toHaveLength(MAX_TICKED_WORKSHOPS)
  expect(ids).not.toContain('w0')
  expect(ids).toContain(`w${MAX_TICKED_WORKSHOPS}`)
})

test('bad stored data is dropped instead of breaking the page', () => {
  expect(parseTicks(null)).toEqual({})
  expect(parseTicks('not json')).toEqual({})
  expect(parseTicks('[1,2]')).toEqual({})
  expect(parseTicks('null')).toEqual({})
  expect(parseTicks('x'.repeat(200_000))).toEqual({})
  expect(
    parseTicks(
      JSON.stringify({
        w1: ['zoom-share', 'zoom-share', 7, 'nope', null],
        w2: 'zoom-share',
        w3: [],
        ['x'.repeat(500)]: ['zoom-share'],
        '': ['zoom-share'],
      }),
    ),
  ).toEqual({ w1: ['zoom-share'] })
})

test('storage that throws only loses the memory across reloads', () => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  const store = createTickStore(broken)
  expect(store.getState().ticks).toEqual({})
  store.getState().setTick('w1', 'zoom-share', true)
  expect(store.getState().ticks).toEqual({ w1: ['zoom-share'] })
  expect(createTickStore(null).getState().ticks).toEqual({})
})
