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

/** A slide by its deck and its 0-based index in that deck. */
export interface SlidePos {
  deckId: string
  index: number
}

type DeckCounts = readonly { id: string; slideCount: number }[]

/** The global 1-based number of a slide, or null if the deck or slide does not exist. */
export function slideNumber(decks: DeckCounts, pos: SlidePos): number | null {
  let start = 1
  for (const d of decks) {
    const count = Math.max(0, d.slideCount)
    if (d.id === pos.deckId) {
      return Number.isInteger(pos.index) && pos.index >= 0 && pos.index < count
        ? start + pos.index
        : null
    }
    start += count
  }
  return null
}

/** The slide with a global 1-based number, or null if there is no such slide. */
export function slideAt(decks: DeckCounts, n: number): SlidePos | null {
  if (!Number.isInteger(n) || n < 1) return null
  let start = 1
  for (const d of decks) {
    const count = Math.max(0, d.slideCount)
    if (n < start + count) return { deckId: d.id, index: n - start }
    start += count
  }
  return null
}

export function totalSlides(decks: DeckCounts): number {
  return decks.reduce((sum, d) => sum + Math.max(0, d.slideCount), 0)
}

/**
 * The slide delta steps away from pos, across decks, stopping at the first and last slide.
 * A slide that no longer exists starts again from the first slide.
 */
export function stepSlide(decks: DeckCounts, pos: SlidePos | null, delta: number): SlidePos | null {
  const total = totalSlides(decks)
  if (total === 0) return null
  const current = pos ? slideNumber(decks, pos) : null
  if (current === null) return slideAt(decks, 1)
  return slideAt(decks, Math.min(total, Math.max(1, current + Math.trunc(delta))))
}

/**
 * Keeps a slide position valid after decks change: the same slide if it still exists, the last
 * slide of the same deck if the deck got shorter, otherwise the first slide (or null).
 */
export function validSlide(decks: DeckCounts, pos: SlidePos | null): SlidePos | null {
  if (pos) {
    if (slideNumber(decks, pos) !== null) return pos
    const deck = decks.find((d) => d.id === pos.deckId)
    if (deck && deck.slideCount > 0) {
      return { deckId: deck.id, index: Math.min(Math.max(0, pos.index), deck.slideCount - 1) }
    }
  }
  return slideAt(decks, 1)
}
