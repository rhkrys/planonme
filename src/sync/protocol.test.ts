import { LIMITS } from '../db/limits'
import { parseMessage, parseScreen, sameScreen, type SyncMessage } from './protocol'

const slide = { mode: 'slide', deckId: 'd1', index: 2, number: 7 }

test('accepts every valid message', () => {
  const valid: SyncMessage[] = [
    {
      v: 1,
      from: 'control',
      type: 'show',
      screen: { mode: 'slide', deckId: 'd1', index: 2, number: 7 },
    },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'blank' } },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'logo', title: 'Kick off' } },
    { v: 1, from: 'control', type: 'hello' },
    { v: 1, from: 'audience', type: 'hello' },
    { v: 1, from: 'audience', type: 'bye' },
    { v: 1, from: 'audience', type: 'status', screen: null, problem: null },
    { v: 1, from: 'audience', type: 'status', screen: { mode: 'blank' }, problem: 'missing' },
    {
      v: 1,
      from: 'audience',
      type: 'status',
      screen: { mode: 'slide', deckId: 'd', index: 0, number: 1 },
      problem: 'error',
    },
  ]
  for (const m of valid) {
    expect(parseMessage(structuredClone(m))).toEqual(m)
  }
})

test('returns a copy, not the incoming object', () => {
  const m = { v: 1, from: 'control', type: 'show', screen: { ...slide } }
  const parsed = parseMessage(m)
  expect(parsed).toEqual(m)
  expect(parsed).not.toBe(m)
  expect(parsed?.type === 'show' && parsed.screen).not.toBe(m.screen)
})

test('ignores junk', () => {
  const junk: unknown[] = [
    null,
    undefined,
    0,
    'show',
    [],
    [1, 'control', 'show'],
    {},
    new Date(),
    { v: 2, from: 'control', type: 'hello' },
    { v: '1', from: 'control', type: 'hello' },
    { from: 'control', type: 'hello' },
    { v: 1, from: 'someone', type: 'hello' },
    { v: 1, from: 'control', type: 'status', screen: null, problem: null },
    { v: 1, from: 'audience', type: 'show', screen: slide },
    { v: 1, from: 'control', type: 'dance' },
    { v: 1, from: 'control', type: 'hello', extra: true },
    { v: 1, from: 'audience', type: 'bye', screen: null },
    { v: 1, from: 'control', type: 'show' },
    { v: 1, from: 'control', type: 'show', screen: null },
    { v: 1, from: 'control', type: 'show', screen: 'blank' },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'party' } },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'blank', title: 'x' } },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'logo' } },
    { v: 1, from: 'control', type: 'show', screen: { mode: 'logo', title: 5 } },
    {
      v: 1,
      from: 'control',
      type: 'show',
      screen: { mode: 'logo', title: 'x'.repeat(LIMITS.maxTitleLength + 1) },
    },
    { v: 1, from: 'audience', type: 'status', screen: null },
    { v: 1, from: 'audience', type: 'status', screen: null, problem: 'gone' },
    { v: 1, from: 'audience', type: 'status', screen: { mode: 'x' }, problem: null },
  ]
  for (const j of junk) expect(parseMessage(j)).toBeNull()
})

test('checks slide fields strictly', () => {
  const bad: unknown[] = [
    { ...slide, deckId: '' },
    { ...slide, deckId: 5 },
    { ...slide, deckId: 'x'.repeat(LIMITS.maxIdLength + 1) },
    { ...slide, index: -1 },
    { ...slide, index: 1.5 },
    { ...slide, index: '2' },
    { ...slide, index: Number.NaN },
    { ...slide, index: Number.POSITIVE_INFINITY },
    { ...slide, index: LIMITS.maxSlidesPerDeck },
    { ...slide, number: 0 },
    { ...slide, number: LIMITS.maxSlidesTotal + 1 },
    { ...slide, url: 'javascript:alert(1)' },
    { mode: 'slide', deckId: 'd1', index: 2 },
  ]
  for (const b of bad) expect(parseScreen(b)).toBeNull()
  expect(parseScreen({ ...slide, index: LIMITS.maxSlidesPerDeck - 1 })).not.toBeNull()
})

test('ignores objects that are not plain or that throw', () => {
  class Fake {
    v = 1
    from = 'control'
    type = 'hello'
  }
  expect(parseMessage(new Fake())).toBeNull()
  const throwing = {
    v: 1,
    from: 'control',
    get type(): string {
      throw new Error('boom')
    },
  }
  expect(parseMessage(throwing)).toBeNull()
  const polluted = JSON.parse('{"v":1,"from":"control","type":"hello","__proto__":{"x":1}}')
  expect(parseMessage(polluted)).toBeNull()
  const bare = Object.assign(Object.create(null) as object, { v: 1, from: 'audience', type: 'bye' })
  expect(parseMessage(bare)).toEqual({ v: 1, from: 'audience', type: 'bye' })
})

test('compares screens', () => {
  expect(sameScreen(null, null)).toBe(true)
  expect(sameScreen({ mode: 'blank' }, null)).toBe(false)
  expect(sameScreen({ mode: 'blank' }, { mode: 'blank' })).toBe(true)
  expect(sameScreen({ mode: 'logo', title: 'a' }, { mode: 'logo', title: 'b' })).toBe(false)
  expect(sameScreen({ mode: 'logo', title: 'a' }, { mode: 'blank' })).toBe(false)
  const a = { mode: 'slide', deckId: 'd', index: 1, number: 2 } as const
  expect(sameScreen(a, { ...a })).toBe(true)
  expect(sameScreen(a, { ...a, index: 2 })).toBe(false)
  expect(sameScreen(a, { ...a, number: 3 })).toBe(false)
})

test('key messages and sender ids are checked', () => {
  expect(parseMessage({ v: 1, from: 'audience', type: 'key', key: ' ', shift: false })).toEqual({
    v: 1,
    from: 'audience',
    type: 'key',
    key: ' ',
    shift: false,
  })
  for (const key of ['PageDown', 'b', 'Escape']) {
    expect(parseMessage({ v: 1, from: 'audience', type: 'key', key, shift: true })).not.toBeNull()
  }
  for (const bad of [
    { v: 1, from: 'audience', type: 'key', key: '1', shift: false },
    { v: 1, from: 'audience', type: 'key', key: 'F5', shift: false },
    { v: 1, from: 'audience', type: 'key', key: ' ', shift: 'no' },
    { v: 1, from: 'audience', type: 'key', key: ' ', shift: false, extra: 1 },
  ]) {
    expect(parseMessage(bad)).toBeNull()
  }
  const screen = { mode: 'blank' }
  expect(parseMessage({ v: 1, from: 'control', type: 'show', screen, sender: 'abc' })).toEqual({
    v: 1,
    from: 'control',
    type: 'show',
    screen,
    sender: 'abc',
  })
  expect(parseMessage({ v: 1, from: 'control', type: 'show', screen, sender: '' })).toBeNull()
  const status = { v: 1, from: 'audience', type: 'status', screen, problem: null }
  expect(parseMessage({ ...status, by: 'abc' })).toMatchObject({ by: 'abc' })
  expect(parseMessage({ ...status, by: null })).toMatchObject({ by: null })
  expect(parseMessage({ ...status, by: 5 })).toBeNull()
})
