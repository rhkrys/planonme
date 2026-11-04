import type { SoundKind } from '../db/types'
import type { CueSegment, InvalidSegment, ParsedScript } from './parse'

/** What a script can point at: the slides and sounds of its workshop. */
export interface CueContext {
  /** Slides across all decks, in deck order. */
  slideCount: number
  sounds: readonly { name: string; kind: SoundKind }[]
}

export interface CueProblem {
  start: number
  end: number
  raw: string
  message: string
}

/** Sound names match without regard to case or repeated spaces. */
export function soundKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function findSound<T extends { name: string }>(
  sounds: readonly T[],
  name: string,
): T | null {
  const key = soundKey(name)
  return sounds.find((s) => soundKey(s.name) === key) ?? null
}

function cueProblem(seg: CueSegment, context: CueContext): string | null {
  const cue = seg.cue
  switch (cue.type) {
    case 'slide':
      if (context.slideCount === 0) return 'There are no slides yet. Add them in Slides.'
      if (cue.slide > context.slideCount) {
        const count = context.slideCount === 1 ? '1 slide' : `${context.slideCount} slides`
        return `There is no slide ${cue.slide}. This workshop has ${count}.`
      }
      return null
    case 'sfx':
    case 'music':
      return findSound(context.sounds, cue.name) ? null : `There is no sound named "${cue.name}".`
    case 'stopMusic':
    case 'timer':
      return null
  }
}

/**
 * Lists problems in a parsed script, in text order. Bad timers and other malformed cues are
 * always checked. Slides and sounds are only checked when a context is given.
 */
export function checkScript(parsed: ParsedScript, context: CueContext | null): CueProblem[] {
  const out: CueProblem[] = []
  for (const seg of parsed.segments) {
    if (seg.kind === 'invalid') {
      out.push(invalidProblem(seg))
    } else if (seg.kind === 'cue' && context) {
      const message = cueProblem(seg, context)
      if (message) out.push({ start: seg.start, end: seg.end, raw: seg.raw, message })
    }
  }
  return out
}

function invalidProblem(seg: InvalidSegment): CueProblem {
  return { start: seg.start, end: seg.end, raw: seg.raw, message: seg.message }
}

/** The 1-based line number of a position in a text. */
export function lineOf(text: string, position: number): number {
  let line = 1
  const end = Math.min(position, text.length)
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++
  return line
}
