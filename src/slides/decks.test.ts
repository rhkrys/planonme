import {
  deckStarts,
  slideAt,
  slideNumber,
  slideRangeLabel,
  stepSlide,
  totalSlides,
  validSlide,
} from './decks'

test('numbers slides across decks in order', () => {
  expect(deckStarts([])).toEqual([])
  expect(deckStarts([{ slideCount: 3 }, { slideCount: 0 }, { slideCount: 2 }])).toEqual([1, 4, 4])
})

test('labels the range of a deck', () => {
  expect(slideRangeLabel(1, 0)).toBe('No slides')
  expect(slideRangeLabel(4, 1)).toBe('Slide 4')
  expect(slideRangeLabel(4, 6)).toBe('Slides 4 to 9')
})

const decks = [
  { id: 'a', slideCount: 2 },
  { id: 'empty', slideCount: 0 },
  { id: 'b', slideCount: 3 },
]

test('turns slide positions into global numbers and back', () => {
  expect(totalSlides(decks)).toBe(5)
  expect(slideNumber(decks, { deckId: 'a', index: 0 })).toBe(1)
  expect(slideNumber(decks, { deckId: 'b', index: 2 })).toBe(5)
  expect(slideNumber(decks, { deckId: 'b', index: 3 })).toBeNull()
  expect(slideNumber(decks, { deckId: 'b', index: -1 })).toBeNull()
  expect(slideNumber(decks, { deckId: 'empty', index: 0 })).toBeNull()
  expect(slideNumber(decks, { deckId: 'gone', index: 0 })).toBeNull()
  expect(slideAt(decks, 3)).toEqual({ deckId: 'b', index: 0 })
  expect(slideAt(decks, 0)).toBeNull()
  expect(slideAt(decks, 6)).toBeNull()
  expect(slideAt(decks, 1.5)).toBeNull()
})

test('steps across decks and stops at the ends', () => {
  expect(stepSlide(decks, { deckId: 'a', index: 1 }, 1)).toEqual({ deckId: 'b', index: 0 })
  expect(stepSlide(decks, { deckId: 'b', index: 0 }, -1)).toEqual({ deckId: 'a', index: 1 })
  expect(stepSlide(decks, { deckId: 'b', index: 2 }, 1)).toEqual({ deckId: 'b', index: 2 })
  expect(stepSlide(decks, { deckId: 'a', index: 0 }, -1)).toEqual({ deckId: 'a', index: 0 })
  expect(stepSlide(decks, { deckId: 'gone', index: 0 }, 1)).toEqual({ deckId: 'a', index: 0 })
  expect(stepSlide(decks, null, 1)).toEqual({ deckId: 'a', index: 0 })
  expect(stepSlide([], null, 1)).toBeNull()
})

test('keeps a slide valid after decks change', () => {
  expect(validSlide(decks, { deckId: 'b', index: 1 })).toEqual({ deckId: 'b', index: 1 })
  expect(validSlide(decks, { deckId: 'b', index: 9 })).toEqual({ deckId: 'b', index: 2 })
  expect(validSlide(decks, { deckId: 'gone', index: 1 })).toEqual({ deckId: 'a', index: 0 })
  expect(validSlide(decks, { deckId: 'empty', index: 0 })).toEqual({ deckId: 'a', index: 0 })
  expect(validSlide(decks, null)).toEqual({ deckId: 'a', index: 0 })
  expect(validSlide([], { deckId: 'a', index: 0 })).toBeNull()
})
