// Cue tokens inside a block script, such as [SLIDE 4], [SFX applause], [MUSIC break-loop],
// [STOP MUSIC] and [TIMER 5m]. Scripts are untrusted text, so the parser never throws:
// anything that does not look like a cue stays plain text.

export type Cue =
  | { type: 'slide'; /** 1-based slide number across all decks of the workshop. */ slide: number }
  | { type: 'sfx'; name: string }
  | { type: 'music'; name: string }
  | { type: 'stopMusic' }
  | { type: 'timer'; seconds: number }

export type CueKeyword = 'SLIDE' | 'SFX' | 'MUSIC' | 'STOP MUSIC' | 'TIMER'

/** Plain text between cues. */
export interface TextSegment {
  kind: 'text'
  text: string
  start: number
  end: number
}

/** A well formed cue token. */
export interface CueSegment {
  kind: 'cue'
  cue: Cue
  /** The token as written, brackets included. */
  raw: string
  start: number
  end: number
}

/** A token with a known keyword but an argument that can not be used, such as [TIMER soon]. */
export interface InvalidSegment {
  kind: 'invalid'
  keyword: CueKeyword
  raw: string
  /** A short readable reason. */
  message: string
  start: number
  end: number
}

export type Segment = TextSegment | CueSegment | InvalidSegment

export interface ParsedScript {
  segments: Segment[]
  /** Only the well formed cues, in order. */
  cues: CueSegment[]
  /** Tokens with a known keyword but a bad argument, in order. */
  invalid: InvalidSegment[]
}

/** Longest text between the brackets that can still be a cue. */
export const MAX_TOKEN_LENGTH = 120
/** Longest timer we accept: one day. */
export const MAX_TIMER_SECONDS = 24 * 60 * 60
/** Highest slide number we accept in a token. */
export const MAX_SLIDE_NUMBER = 99_999

const TIMER_PATTERN = /^(?:(\d{1,5})h)?\s*(?:(\d{1,5})m)?\s*(?:(\d{1,5})s)?$/i

/** Parses a timer length such as 5m, 30s or 1m30s into seconds, or returns null. */
export function parseTimer(value: string): number | null {
  const v = value.trim()
  if (v === '') return null
  const m = TIMER_PATTERN.exec(v)
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  const seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return seconds
}

/** Writes seconds the way a timer token does, for example 90 becomes 1m30s. */
export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  let out = ''
  if (h > 0) out += `${h}h`
  if (m > 0) out += `${m}m`
  if (rest > 0 || out === '') out += `${rest}s`
  return out
}

type TokenResult =
  { kind: 'cue'; cue: Cue } | { kind: 'invalid'; keyword: CueKeyword; message: string } | null

/** Reads the inside of one bracket pair. Returns null when it is not a cue at all. */
export function parseToken(inner: string): TokenResult {
  const body = inner.trim()
  const m = /^([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(body)
  if (!m) return null
  const word = (m[1] ?? '').toUpperCase()
  const arg = (m[2] ?? '').trim()

  switch (word) {
    case 'SLIDE': {
      if (arg === '') return { kind: 'invalid', keyword: 'SLIDE', message: 'Add a slide number.' }
      if (!/^\d+$/.test(arg)) {
        return { kind: 'invalid', keyword: 'SLIDE', message: 'Slide number must be a number.' }
      }
      const n = Number(arg)
      if (n < 1) return { kind: 'invalid', keyword: 'SLIDE', message: 'Slides start at 1.' }
      if (n > MAX_SLIDE_NUMBER) {
        return { kind: 'invalid', keyword: 'SLIDE', message: 'Slide number is too big.' }
      }
      return { kind: 'cue', cue: { type: 'slide', slide: n } }
    }
    case 'SFX':
    case 'MUSIC': {
      const keyword = word
      if (arg === '') return { kind: 'invalid', keyword, message: 'Add a sound name.' }
      const name = arg.replace(/\s+/g, ' ')
      return {
        kind: 'cue',
        cue: keyword === 'SFX' ? { type: 'sfx', name } : { type: 'music', name },
      }
    }
    case 'STOP': {
      const rest = arg.split(/\s+/)
      if ((rest[0] ?? '').toUpperCase() !== 'MUSIC') return null
      if (rest.length > 1) {
        return { kind: 'invalid', keyword: 'STOP MUSIC', message: 'Stop music takes no name.' }
      }
      return { kind: 'cue', cue: { type: 'stopMusic' } }
    }
    case 'TIMER': {
      if (arg === '') {
        return { kind: 'invalid', keyword: 'TIMER', message: 'Add a time, such as 5m or 30s.' }
      }
      const seconds = parseTimer(arg)
      if (seconds === null) {
        return {
          kind: 'invalid',
          keyword: 'TIMER',
          message: 'Use a time such as 5m, 30s or 1m30s.',
        }
      }
      if (seconds === 0) {
        return { kind: 'invalid', keyword: 'TIMER', message: 'Timer must be longer than 0s.' }
      }
      if (seconds > MAX_TIMER_SECONDS) {
        return { kind: 'invalid', keyword: 'TIMER', message: 'Timer can be at most 24h.' }
      }
      return { kind: 'cue', cue: { type: 'timer', seconds } }
    }
    default:
      return null
  }
}

/** Splits a script into text and cue segments. Never throws. */
export function parseScript(input: unknown): ParsedScript {
  const text = typeof input === 'string' ? input : ''
  const segments: Segment[] = []
  const cues: CueSegment[] = []
  const invalid: InvalidSegment[] = []
  let textStart = 0

  function pushText(end: number) {
    if (end > textStart) {
      segments.push({ kind: 'text', text: text.slice(textStart, end), start: textStart, end })
    }
  }

  let i = text.indexOf('[')
  while (i !== -1) {
    // Find the closing bracket. Another '[' or a line break first means this '[' is just text.
    let close = -1
    const limit = Math.min(text.length, i + 1 + MAX_TOKEN_LENGTH + 1)
    for (let j = i + 1; j < limit; j++) {
      const ch = text[j]
      if (ch === ']') {
        close = j
        break
      }
      if (ch === '[' || ch === '\n' || ch === '\r') break
    }
    if (close === -1) {
      i = text.indexOf('[', i + 1)
      continue
    }
    const result = parseToken(text.slice(i + 1, close))
    if (result === null) {
      i = text.indexOf('[', close + 1)
      continue
    }
    pushText(i)
    const raw = text.slice(i, close + 1)
    const end = close + 1
    if (result.kind === 'cue') {
      const seg: CueSegment = { kind: 'cue', cue: result.cue, raw, start: i, end }
      segments.push(seg)
      cues.push(seg)
    } else {
      const seg: InvalidSegment = {
        kind: 'invalid',
        keyword: result.keyword,
        raw,
        message: result.message,
        start: i,
        end,
      }
      segments.push(seg)
      invalid.push(seg)
    }
    textStart = end
    i = text.indexOf('[', end)
  }
  pushText(text.length)
  return { segments, cues, invalid }
}

/** Writes a cue back as a token. */
export function formatCue(cue: Cue): string {
  switch (cue.type) {
    case 'slide':
      return `[SLIDE ${cue.slide}]`
    case 'sfx':
      return `[SFX ${cue.name}]`
    case 'music':
      return `[MUSIC ${cue.name}]`
    case 'stopMusic':
      return '[STOP MUSIC]'
    case 'timer':
      return `[TIMER ${formatTimer(cue.seconds)}]`
  }
}
