import {
  computeSchedule,
  formatDuration,
  formatOffset,
  MAX_BLOCK_MINUTES,
  moveItem,
  parseMinutes,
} from './timing'

describe('computeSchedule', () => {
  test('gives start offsets, total and time left', () => {
    const s = computeSchedule(
      [
        { id: 'a', durationMin: 10 },
        { id: 'b', durationMin: 30 },
        { id: 'c', durationMin: 15 },
      ],
      60,
    )
    expect(s.rows.map((r) => [r.id, r.startMin, r.endMin])).toEqual([
      ['a', 0, 10],
      ['b', 10, 40],
      ['c', 40, 55],
    ])
    expect(s.totalMin).toBe(55)
    expect(s.remainingMin).toBe(5)
    expect(s.overMin).toBe(0)
    expect(s.isOver).toBe(false)
    expect(s.rows.some((r) => r.pastEnd)).toBe(false)
  })

  test('exactly full is not over time', () => {
    const s = computeSchedule([{ id: 'a', durationMin: 60 }], 60)
    expect(s.isOver).toBe(false)
    expect(s.remainingMin).toBe(0)
    expect(s.rows[0]?.pastEnd).toBe(false)
  })

  test('marks over time and the blocks past the end', () => {
    const s = computeSchedule(
      [
        { id: 'a', durationMin: 40 },
        { id: 'b', durationMin: 30 },
        { id: 'c', durationMin: 5 },
      ],
      60,
    )
    expect(s.isOver).toBe(true)
    expect(s.overMin).toBe(15)
    expect(s.remainingMin).toBe(0)
    expect(s.rows.map((r) => r.pastEnd)).toEqual([false, true, true])
  })

  test('no session length means no warning', () => {
    const s = computeSchedule([{ id: 'a', durationMin: 500 }], 0)
    expect(s.hasSession).toBe(false)
    expect(s.isOver).toBe(false)
    expect(s.totalMin).toBe(500)
    expect(s.rows[0]?.pastEnd).toBe(false)
  })

  test('empty list', () => {
    const s = computeSchedule([], 90)
    expect(s.rows).toEqual([])
    expect(s.totalMin).toBe(0)
    expect(s.remainingMin).toBe(90)
  })

  test('bad numbers are treated as safe values', () => {
    const s = computeSchedule(
      [
        { id: 'a', durationMin: Number.NaN },
        { id: 'b', durationMin: -20 },
        { id: 'c', durationMin: Number.POSITIVE_INFINITY },
        { id: 'd', durationMin: 2.6 },
      ],
      Number.NaN,
    )
    expect(s.rows.map((r) => r.endMin - r.startMin)).toEqual([0, 0, 0, 3])
    expect(s.totalMin).toBe(3)
    expect(s.hasSession).toBe(false)
  })
})

test('formatDuration', () => {
  expect(formatDuration(0)).toBe('0 min')
  expect(formatDuration(45)).toBe('45 min')
  expect(formatDuration(60)).toBe('1 h')
  expect(formatDuration(90)).toBe('1 h 30 min')
  expect(formatDuration(-5)).toBe('0 min')
  expect(formatDuration(Number.NaN)).toBe('0 min')
})

test('formatOffset', () => {
  expect(formatOffset(0)).toBe('0:00')
  expect(formatOffset(5)).toBe('0:05')
  expect(formatOffset(90)).toBe('1:30')
  expect(formatOffset(600)).toBe('10:00')
})

describe('parseMinutes', () => {
  test('accepts whole numbers in range', () => {
    expect(parseMinutes('0', MAX_BLOCK_MINUTES)).toEqual({ ok: true, value: 0 })
    expect(parseMinutes(' 45 ', MAX_BLOCK_MINUTES)).toEqual({ ok: true, value: 45 })
    expect(parseMinutes('600', MAX_BLOCK_MINUTES)).toEqual({ ok: true, value: 600 })
    expect(parseMinutes('007', MAX_BLOCK_MINUTES)).toEqual({ ok: true, value: 7 })
  })

  test('rejects anything else with a readable message', () => {
    for (const bad of ['1.5', '-1', 'abc', '1e3', '10 min', '+5', '0x10']) {
      const r = parseMinutes(bad, MAX_BLOCK_MINUTES)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/whole minutes/)
    }
    const big = parseMinutes('601', MAX_BLOCK_MINUTES)
    expect(big).toEqual({ ok: false, error: 'Use 600 minutes or less.' })
    expect(parseMinutes('99999999999999999999', MAX_BLOCK_MINUTES).ok).toBe(false)
  })

  test('empty input', () => {
    expect(parseMinutes('', 600).ok).toBe(false)
    expect(parseMinutes('  ', 600, { allowEmpty: true })).toEqual({ ok: true, value: 0 })
  })
})

test('moveItem', () => {
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  expect(moveItem(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c'])
  expect(moveItem(['a', 'b', 'c'], 0, 3)).toEqual(['a', 'b', 'c'])
  const list = ['a', 'b']
  moveItem(list, 0, 1)
  expect(list).toEqual(['a', 'b'])
})
