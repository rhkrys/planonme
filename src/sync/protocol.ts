// Messages between the control window and the audience window. Both windows run the same app on
// the same origin, but a message can still come from an old version of the app in another tab,
// a browser extension or a bug, so every incoming message is checked before it is used.

import { LIMITS } from '../db/limits'
import { isRecord } from '../db/normalize'

export const CHANNEL_NAME = 'planonme'
export const PROTOCOL_VERSION = 1

/** What the audience window shows. */
export type AudienceScreen =
  /** One slide. number is its global slide number, used for the image description. */
  | { mode: 'slide'; deckId: string; index: number; number: number }
  /** A black screen. */
  | { mode: 'blank' }
  /** The workshop title on black, for before and between sessions. */
  | { mode: 'logo'; title: string }

/** Why the audience window cannot show the slide it was asked for. */
export type SlideProblem = 'missing' | 'error'

export type ControlMessage =
  /** Show this screen. */
  | { v: 1; from: 'control'; type: 'show'; screen: AudienceScreen }
  /** Asks any audience window to answer with a status message. Also sent as a heartbeat. */
  | { v: 1; from: 'control'; type: 'hello' }

export type AudienceMessage =
  /** The audience window just opened or reloaded and asks for the screen to show. */
  | { v: 1; from: 'audience'; type: 'hello' }
  /** What the audience window shows now. screen is null while it waits for the first one. */
  | {
      v: 1
      from: 'audience'
      type: 'status'
      screen: AudienceScreen | null
      problem: SlideProblem | null
    }
  /** The audience window is closing. */
  | { v: 1; from: 'audience'; type: 'bye' }

export type SyncMessage = ControlMessage | AudienceMessage

const PROBLEMS: readonly SlideProblem[] = ['missing', 'error']

function hasOnlyKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
    return false
  }
  const own = Object.keys(v)
  return own.length === keys.length && own.every((k) => keys.includes(k))
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= LIMITS.maxIdLength
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

/** A checked copy of a screen, or null if it is not a valid screen. */
export function parseScreen(v: unknown): AudienceScreen | null {
  if (!isRecord(v)) return null
  switch (v.mode) {
    case 'slide':
      if (!hasOnlyKeys(v, ['mode', 'deckId', 'index', 'number'])) return null
      if (!isId(v.deckId)) return null
      if (!isIntIn(v.index, 0, LIMITS.maxSlidesPerDeck - 1)) return null
      if (!isIntIn(v.number, 1, LIMITS.maxSlidesTotal)) return null
      return { mode: 'slide', deckId: v.deckId, index: v.index, number: v.number }
    case 'blank':
      return hasOnlyKeys(v, ['mode']) ? { mode: 'blank' } : null
    case 'logo':
      if (!hasOnlyKeys(v, ['mode', 'title'])) return null
      if (typeof v.title !== 'string' || v.title.length > LIMITS.maxTitleLength) return null
      return { mode: 'logo', title: v.title }
    default:
      return null
  }
}

/**
 * A checked copy of an incoming message, or null for anything else. Unknown versions, types,
 * extra fields and wrong field types are all rejected, so junk is ignored.
 */
export function parseMessage(data: unknown): SyncMessage | null {
  try {
    if (!isRecord(data) || data.v !== PROTOCOL_VERSION) return null
    if (data.from === 'control') {
      if (data.type === 'hello') {
        return hasOnlyKeys(data, ['v', 'from', 'type'])
          ? { v: 1, from: 'control', type: 'hello' }
          : null
      }
      if (data.type === 'show') {
        if (!hasOnlyKeys(data, ['v', 'from', 'type', 'screen'])) return null
        const screen = parseScreen(data.screen)
        return screen ? { v: 1, from: 'control', type: 'show', screen } : null
      }
      return null
    }
    if (data.from === 'audience') {
      if (data.type === 'hello' || data.type === 'bye') {
        return hasOnlyKeys(data, ['v', 'from', 'type'])
          ? { v: 1, from: 'audience', type: data.type }
          : null
      }
      if (data.type === 'status') {
        if (!hasOnlyKeys(data, ['v', 'from', 'type', 'screen', 'problem'])) return null
        const screen = data.screen === null ? null : parseScreen(data.screen)
        if (data.screen !== null && !screen) return null
        const problem = data.problem === null ? null : PROBLEMS.find((p) => p === data.problem)
        if (problem === undefined) return null
        return { v: 1, from: 'audience', type: 'status', screen, problem }
      }
      return null
    }
    return null
  } catch {
    // A hostile object (a throwing getter, for example) is junk too.
    return null
  }
}

export function sameScreen(a: AudienceScreen | null, b: AudienceScreen | null): boolean {
  if (a === null || b === null) return a === b
  if (a.mode === 'slide' && b.mode === 'slide') {
    return a.deckId === b.deckId && a.index === b.index && a.number === b.number
  }
  if (a.mode === 'logo' && b.mode === 'logo') return a.title === b.title
  return a.mode === b.mode
}

/** A two way message pipe. The real one wraps BroadcastChannel; tests use a fake. */
export interface SyncChannel {
  post: (message: SyncMessage) => void
  /** Calls the listener with every valid incoming message. Returns an unsubscribe function. */
  listen: (listener: (message: SyncMessage) => void) => () => void
  close: () => void
}

/**
 * Opens the app's BroadcastChannel, or returns null if the browser does not have one or refuses
 * to open it.
 */
export function openBroadcastChannel(name = CHANNEL_NAME): SyncChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  let channel: BroadcastChannel
  try {
    channel = new BroadcastChannel(name)
  } catch (err) {
    console.error(err)
    return null
  }
  const listeners = new Set<(message: SyncMessage) => void>()
  channel.onmessage = (e: MessageEvent) => {
    const message = parseMessage(e.data)
    if (!message) return
    for (const l of listeners) {
      try {
        l(message)
      } catch (err) {
        console.error(err)
      }
    }
  }
  let closed = false
  return {
    post: (message) => {
      if (closed) return
      try {
        channel.postMessage(message)
      } catch (err) {
        console.error(err)
      }
    },
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => {
      closed = true
      listeners.clear()
      channel.onmessage = null
      channel.close()
    },
  }
}
