import { deckStarts, slideRangeLabel } from './decks'

test('numbers slides across decks in order', () => {
  expect(deckStarts([])).toEqual([])
  expect(deckStarts([{ slideCount: 3 }, { slideCount: 0 }, { slideCount: 2 }])).toEqual([1, 4, 4])
})

test('labels the range of a deck', () => {
  expect(slideRangeLabel(1, 0)).toBe('No slides')
  expect(slideRangeLabel(4, 1)).toBe('Slide 4')
  expect(slideRangeLabel(4, 6)).toBe('Slides 4 to 9')
})
