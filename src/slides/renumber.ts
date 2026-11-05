// Slide numbers in [SLIDE n] cues count across all decks of a workshop. When a deck moves or is
// deleted, those numbers change. These helpers rewrite the cues in the scripts, so each cue keeps
// showing the slide it showed before.

import { parseScript } from '../cues/parse'

export interface DeckCount {
  id: string
  slideCount: number
}

/** Written in place of a cue whose slide was in a deleted deck. */
export const GONE_SLIDE_TOKEN = '[SLIDE ?]'

/**
 * Maps a slide number in the old deck order to the number of the same slide in the new order.
 * Gives null for a slide whose deck is gone, and undefined for a number that was not a slide.
 */
export function slideNumberMap(
  before: readonly DeckCount[],
  after: readonly DeckCount[],
): (n: number) => number | null | undefined {
  const startAfter = new Map<string, number>()
  let total = 0
  for (const d of after) {
    startAfter.set(d.id, total)
    total += Math.max(0, d.slideCount)
  }
  return (n) => {
    let start = 0
    for (const d of before) {
      const count = Math.max(0, d.slideCount)
      if (n > start && n <= start + count) {
        const newStart = startAfter.get(d.id)
        return newStart === undefined ? null : newStart + (n - start)
      }
      start += count
    }
    return undefined
  }
}

/** Rewrites the [SLIDE n] cues of a script. Returns the new script and how many cues changed. */
export function renumberSlideCues(
  script: string,
  map: (n: number) => number | null | undefined,
): { script: string; changed: number } {
  let out = ''
  let at = 0
  let changed = 0
  for (const seg of parseScript(script).segments) {
    if (seg.kind !== 'cue' || seg.cue.type !== 'slide') continue
    const next = map(seg.cue.slide)
    if (next === undefined || next === seg.cue.slide) continue
    out += script.slice(at, seg.start) + (next === null ? GONE_SLIDE_TOKEN : `[SLIDE ${next}]`)
    at = seg.end
    changed++
  }
  return changed === 0 ? { script, changed } : { script: out + script.slice(at), changed }
}
