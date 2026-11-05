import {
  describeDelta,
  elapsedMs,
  formatClock,
  isFresh,
  pauseClock,
  scheduleDelta,
  startClock,
  STOPPED,
  timerLeft,
} from './clock'

test('the session clock starts, pauses and resumes', () => {
  expect(isFresh(STOPPED)).toBe(true)
  let c = startClock(STOPPED, 1000)
  expect(elapsedMs(c, 4000)).toBe(3000)
  expect(startClock(c, 9000)).toBe(c)
  c = pauseClock(c, 5000)
  expect(c.running).toBe(false)
  expect(elapsedMs(c, 99_000)).toBe(4000)
  expect(isFresh(c)).toBe(false)
  c = startClock(c, 10_000)
  expect(elapsedMs(c, 11_000)).toBe(5000)
  expect(pauseClock(STOPPED, 5)).toBe(STOPPED)
})

test('the clock never runs backwards', () => {
  const c = startClock(STOPPED, 5000)
  expect(elapsedMs(c, 1000)).toBe(0)
  expect(elapsedMs(c, Number.NaN)).toBe(0)
})

test('formatClock writes m:ss or h:mm:ss', () => {
  expect(formatClock(0)).toBe('0:00')
  expect(formatClock(59.9)).toBe('0:59')
  expect(formatClock(605)).toBe('10:05')
  expect(formatClock(3725)).toBe('1:02:05')
  expect(formatClock(-90)).toBe('-1:30')
  expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
})

test('timerLeft counts down in whole seconds and stops at 0', () => {
  const t = { seconds: 10, startedAt: 1000 }
  expect(timerLeft(t, 1000)).toBe(10)
  expect(timerLeft(t, 1500)).toBe(10)
  expect(timerLeft(t, 2000)).toBe(9)
  expect(timerLeft(t, 60_000)).toBe(0)
})

describe('scheduleDelta', () => {
  const block = { plannedStartSec: 600, plannedSec: 300 }

  test('is 0 when a block starts on time and runs within its time', () => {
    expect(scheduleDelta({ ...block, blockStartSec: 600, elapsedSec: 700 })).toBe(0)
  })

  test('counts a late start and time past the planned length', () => {
    expect(scheduleDelta({ ...block, blockStartSec: 660, elapsedSec: 700 })).toBe(60)
    expect(scheduleDelta({ ...block, blockStartSec: 600, elapsedSec: 1000 })).toBe(100)
  })

  test('is negative when the block started early', () => {
    expect(scheduleDelta({ ...block, blockStartSec: 480, elapsedSec: 500 })).toBe(-120)
  })
})

test('describeDelta says ahead, behind or on time', () => {
  expect(describeDelta(10)).toEqual({ state: 'on-time', label: 'On time' })
  expect(describeDelta(-29)).toEqual({ state: 'on-time', label: 'On time' })
  expect(describeDelta(125)).toEqual({ state: 'behind', label: '2:05 behind' })
  expect(describeDelta(-60)).toEqual({ state: 'ahead', label: '1:00 ahead' })
  expect(describeDelta(Number.NaN).state).toBe('on-time')
})
