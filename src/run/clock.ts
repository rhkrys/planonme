// Session timing for Run mode. Pure functions; the caller passes the current time in ms.

/** A stopwatch that can pause. */
export interface SessionClock {
  running: boolean
  /** When the clock last started running. Only used while running. */
  startedAt: number
  /** Time run before the last start, in ms. */
  accumulated: number
}

export const STOPPED: SessionClock = { running: false, startedAt: 0, accumulated: 0 }

export function elapsedMs(clock: SessionClock, now: number): number {
  const run = clock.running && Number.isFinite(now) ? Math.max(0, now - clock.startedAt) : 0
  return Math.max(0, clock.accumulated + run)
}

export function startClock(clock: SessionClock, now: number): SessionClock {
  if (clock.running) return clock
  return { running: true, startedAt: now, accumulated: clock.accumulated }
}

export function pauseClock(clock: SessionClock, now: number): SessionClock {
  if (!clock.running) return clock
  return { running: false, startedAt: 0, accumulated: elapsedMs(clock, now) }
}

/** True before the session was ever started (or after a reset). */
export function isFresh(clock: SessionClock): boolean {
  return !clock.running && clock.accumulated === 0
}

/** Seconds as m:ss or h:mm:ss, with a leading minus for negative values. */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? seconds : 0
  const sign = safe < 0 ? '-' : ''
  const total = Math.floor(Math.abs(safe))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${s}`
  return `${sign}${m}:${s}`
}

/** A countdown that runs on the wall clock, started by a [TIMER] cue. */
export interface CueTimer {
  seconds: number
  startedAt: number
}

/** Whole seconds left on a timer, never below 0. Rounded up, so it shows 0 only at the end. */
export function timerLeft(timer: CueTimer, now: number): number {
  const left = timer.seconds - Math.max(0, now - timer.startedAt) / 1000
  return Math.max(0, Math.ceil(left))
}

export interface ScheduleInput {
  /** Session time when the running block started, in seconds. */
  blockStartSec: number
  /** Session time now, in seconds. */
  elapsedSec: number
  /** When the planner says the block starts, in seconds from the session start. */
  plannedStartSec: number
  /** How long the planner gives the block, in seconds. */
  plannedSec: number
}

/**
 * How far behind the plan the session is, in seconds. Negative means ahead. It counts a late
 * (or early) block start, plus any time the running block has gone past its planned length.
 */
export function scheduleDelta(input: ScheduleInput): number {
  const inBlock = Math.max(0, input.elapsedSec - input.blockStartSec)
  const late = input.blockStartSec - input.plannedStartSec
  const over = Math.max(0, inBlock - Math.max(0, input.plannedSec))
  return late + over
}

/** Within this many seconds of the plan counts as on time. */
export const ON_TIME_SECONDS = 30

export type ScheduleState = 'ahead' | 'behind' | 'on-time'

export function describeDelta(deltaSec: number): { state: ScheduleState; label: string } {
  if (!Number.isFinite(deltaSec) || Math.abs(deltaSec) < ON_TIME_SECONDS) {
    return { state: 'on-time', label: 'On time' }
  }
  const amount = formatClock(Math.abs(deltaSec))
  return deltaSec > 0
    ? { state: 'behind', label: `${amount} behind` }
    : { state: 'ahead', label: `${amount} ahead` }
}
