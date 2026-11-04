// Timing math for the planner. Pure functions, so they are easy to test.

import { LIMITS } from '../../db/limits'
import type { BlockKind } from '../../db/types'

/** Largest duration of one block that the planner accepts, in minutes. */
export const MAX_BLOCK_MINUTES = 600

/** Largest session length that the planner accepts, in minutes. */
export const MAX_SESSION_MINUTES = LIMITS.maxWorkshopMinutes

export const KIND_LABELS: Record<BlockKind, string> = {
  talk: 'Talk',
  exercise: 'Exercise',
  break: 'Break',
  discussion: 'Discussion',
}

export interface ScheduleRow {
  id: string
  /** Minutes from the start of the session. */
  startMin: number
  endMin: number
  /** True when the block ends after the session length. */
  pastEnd: boolean
}

export interface Schedule {
  rows: ScheduleRow[]
  totalMin: number
  sessionMin: number
  /** False when no session length is set (0 minutes). */
  hasSession: boolean
  /** Minutes still free in the session. Never below 0. */
  remainingMin: number
  /** Minutes over the session length. Never below 0. */
  overMin: number
  isOver: boolean
}

/** Turns any value into a whole number of minutes from 0 to max. */
function safeMinutes(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.min(max, Math.max(0, Math.round(v)))
}

/** Start and end of each block, plus the total against the session length. */
export function computeSchedule(
  blocks: readonly { id: string; durationMin: number }[],
  sessionMinutes: number,
): Schedule {
  const sessionMin = safeMinutes(sessionMinutes, MAX_SESSION_MINUTES)
  const hasSession = sessionMin > 0
  const rows: ScheduleRow[] = []
  let at = 0
  for (const b of blocks) {
    const startMin = at
    const endMin = startMin + safeMinutes(b.durationMin, LIMITS.maxBlockMinutes)
    rows.push({ id: b.id, startMin, endMin, pastEnd: hasSession && endMin > sessionMin })
    at = endMin
  }
  const totalMin = at
  const overMin = hasSession ? Math.max(0, totalMin - sessionMin) : 0
  return {
    rows,
    totalMin,
    sessionMin,
    hasSession,
    remainingMin: hasSession ? Math.max(0, sessionMin - totalMin) : 0,
    overMin,
    isOver: overMin > 0,
  }
}

/** A length such as "45 min", "1 h" or "1 h 30 min". */
export function formatDuration(minutes: number): string {
  const m = safeMinutes(minutes, Number.MAX_SAFE_INTEGER)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} min`
  if (rest === 0) return `${h} h`
  return `${h} h ${rest} min`
}

/** An offset from the session start as h:mm, such as "0:05" or "1:30". */
export function formatOffset(minutes: number): string {
  const m = safeMinutes(minutes, Number.MAX_SAFE_INTEGER)
  const h = Math.floor(m / 60)
  return `${h}:${String(m % 60).padStart(2, '0')}`
}

export type ParsedMinutes = { ok: true; value: number } | { ok: false; error: string }

/** Reads whole minutes typed by the user. Empty text is 0 only when allowEmpty is set. */
export function parseMinutes(
  input: string,
  max: number,
  options: { allowEmpty?: boolean } = {},
): ParsedMinutes {
  const text = input.trim()
  if (text === '') {
    return options.allowEmpty ? { ok: true, value: 0 } : { ok: false, error: 'Enter the minutes.' }
  }
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: `Use whole minutes from 0 to ${max}.` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value > max) {
    return { ok: false, error: `Use ${max} minutes or less.` }
  }
  return { ok: true, value }
}

/** A copy of the list with one item moved from one index to another. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice()
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out
  const [item] = out.splice(from, 1)
  if (item === undefined) return list.slice()
  out.splice(to, 0, item)
  return out
}
