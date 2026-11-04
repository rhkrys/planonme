import type { DeckSource } from '../db/types'

/** Plain names for where a deck came from, in the order shown in the import form. */
export const SOURCE_LABELS: Record<DeckSource, string> = {
  pptx: 'PowerPoint',
  gslides: 'Google Slides',
  canva: 'Canva',
  gamma: 'Gamma',
  pdf: 'Other PDF',
}

/**
 * The global number of each deck's first slide. Slides are numbered across decks in deck order,
 * the same way [SLIDE n] cues count them.
 */
export function deckStarts(decks: readonly { slideCount: number }[]): number[] {
  const starts: number[] = []
  let next = 1
  for (const d of decks) {
    starts.push(next)
    next += Math.max(0, d.slideCount)
  }
  return starts
}

/** "Slide 4" or "Slides 4 to 9", for a deck that starts at the given global number. */
export function slideRangeLabel(start: number, count: number): string {
  if (count <= 0) return 'No slides'
  if (count === 1) return `Slide ${start}`
  return `Slides ${start} to ${start + count - 1}`
}
