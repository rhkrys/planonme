// Autocomplete for cue tokens: what the user is typing after a '[' and what to offer.

import type { SoundKind } from '../db/types'
import { MAX_TOKEN_LENGTH } from './parse'

export interface CompletionMedia {
  decks: readonly { name: string; slideCount: number }[]
  sounds: readonly { name: string; kind: SoundKind }[]
}

export interface CueOption {
  id: string
  /** Main text, such as "SLIDE 3". */
  label: string
  /** Extra text, such as the deck name. */
  detail: string
  /** Text that replaces what was typed after the '['. Ends with ']' when the cue is complete. */
  insert: string
}

export interface CompletionQuery {
  /** Position of the '['. */
  start: number
  /** What is typed between the '[' and the caret. */
  query: string
}

/** Most options shown at once. */
export const MAX_OPTIONS = 50
/** Most slides offered when nothing is typed yet. */
const MAX_SLIDE_OPTIONS = 2000

/** Finds an open '[' before the caret on the same line, or null. */
export function findCompletionQuery(text: string, caret: number): CompletionQuery | null {
  if (caret < 1 || caret > text.length) return null
  const stop = Math.max(0, caret - MAX_TOKEN_LENGTH - 1)
  for (let i = caret - 1; i >= stop; i--) {
    const ch = text[i]
    if (ch === '[') return { start: i, query: text.slice(i + 1, caret) }
    if (ch === ']' || ch === '\n' || ch === '\r') return null
  }
  return null
}

/** All options for a workshop: cue types first, then slides, then sounds. */
export function buildOptions(media: CompletionMedia): CueOption[] {
  const out: CueOption[] = [
    { id: 'type-slide', label: 'SLIDE', detail: 'Show a slide', insert: 'SLIDE ' },
    { id: 'type-sfx', label: 'SFX', detail: 'Play a sound effect', insert: 'SFX ' },
    { id: 'type-music', label: 'MUSIC', detail: 'Play music', insert: 'MUSIC ' },
    { id: 'type-stop', label: 'STOP MUSIC', detail: 'Stop the music', insert: 'STOP MUSIC]' },
    { id: 'type-timer', label: 'TIMER', detail: 'Start a timer', insert: 'TIMER ' },
  ]
  for (const t of ['30s', '1m', '5m', '10m']) {
    out.push({ id: `timer-${t}`, label: `TIMER ${t}`, detail: 'Timer', insert: `TIMER ${t}]` })
  }
  let n = 0
  for (const deck of media.decks) {
    for (let k = 1; k <= deck.slideCount && n < MAX_SLIDE_OPTIONS; k++) {
      n++
      out.push({
        id: `slide-${n}`,
        label: `SLIDE ${n}`,
        detail: `${deck.name}, slide ${k}`,
        insert: `SLIDE ${n}]`,
      })
    }
  }
  media.sounds.forEach((s, i) => {
    const name = s.name.trim().replace(/\s+/g, ' ')
    if (!name || name.includes(']') || name.includes('[')) return
    const word = s.kind === 'music' ? 'MUSIC' : 'SFX'
    // A name too long for a token could never be cued, so do not offer it.
    if (word.length + 1 + name.length > MAX_TOKEN_LENGTH) return
    out.push({
      id: `sound-${i}`,
      label: `${word} ${name}`,
      detail: s.kind === 'music' ? 'Music' : 'Sound effect',
      insert: `${word} ${name}]`,
    })
  })
  return out
}

/** Options that fit what is typed, at most `max` of them. */
export function filterOptions(
  options: readonly CueOption[],
  query: string,
  max = MAX_OPTIONS,
): CueOption[] {
  const q = query.replace(/\s+/g, ' ').trimStart().toLowerCase()
  const out: CueOption[] = []
  for (const o of options) {
    if (out.length >= max) break
    const insert = o.insert.toLowerCase()
    // A cue type is already typed in full, so it would add nothing.
    if (!insert.endsWith(']') && insert.trimEnd() === q.trimEnd()) continue
    if (q === '' || insert.startsWith(q)) {
      out.push(o)
      continue
    }
    // "[app" finds "SFX applause": match the words after the keyword too.
    if (!q.includes(' ') && o.label.toLowerCase().split(' ').slice(1).join(' ').includes(q)) {
      out.push(o)
    }
  }
  return out
}

/** Puts an option into the text. Returns the new text, the caret and whether the cue is done. */
export function applyOption(
  text: string,
  query: CompletionQuery,
  caret: number,
  option: CueOption,
): { text: string; caret: number; done: boolean } {
  const done = option.insert.endsWith(']')
  let insert = option.insert
  // Do not double a closing bracket that is already there.
  if (done && text[caret] === ']') insert = insert.slice(0, -1)
  const before = text.slice(0, query.start + 1)
  const after = text.slice(caret)
  const next = before + insert + after
  const newCaret = before.length + insert.length + (done && insert !== option.insert ? 1 : 0)
  return { text: next, caret: newCaret, done }
}
