import { createAudienceStore, screenFor } from './audienceStore'

const decks = [
  { id: 'a', slideCount: 2 },
  { id: 'b', slideCount: 1 },
]

function make() {
  return createAudienceStore(() => decks)
}

test('steps through slides and shows a chosen one', () => {
  const store = make()
  store.getState().step(1)
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 0 })
  store.getState().step(1)
  store.getState().step(1)
  expect(store.getState().slide).toEqual({ deckId: 'b', index: 0 })
  store.getState().step(1)
  expect(store.getState().slide).toEqual({ deckId: 'b', index: 0 })
  store.getState().showSlide({ deckId: 'a', index: 1 })
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 1 })
  // A slide that does not exist is ignored.
  store.getState().showSlide({ deckId: 'a', index: 5 })
  store.getState().showSlide({ deckId: 'zz', index: 0 })
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 1 })
})

test('blank and logo screens toggle and cover the slide', () => {
  const store = make()
  store.getState().showSlide({ deckId: 'a', index: 1 })
  store.getState().toggleBlank()
  expect(store.getState().overlay).toBe('blank')
  store.getState().toggleLogo()
  expect(store.getState().overlay).toBe('logo')
  store.getState().toggleLogo()
  expect(store.getState().overlay).toBe('none')
  store.getState().toggleBlank()
  // The first step only uncovers the same slide.
  store.getState().step(1)
  expect(store.getState().overlay).toBe('none')
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 1 })
  // Showing a slide takes a cover away too.
  store.getState().toggleLogo()
  store.getState().showSlide({ deckId: 'b', index: 0 })
  expect(store.getState().overlay).toBe('none')
})

test('works out the screen to send', () => {
  const slide = { deckId: 'b', index: 0 }
  expect(screenFor({ slide, overlay: 'none' }, decks, 'T')).toEqual({
    mode: 'slide',
    deckId: 'b',
    index: 0,
    number: 3,
  })
  expect(screenFor({ slide, overlay: 'blank' }, decks, 'T')).toEqual({ mode: 'blank' })
  expect(screenFor({ slide, overlay: 'logo' }, decks, 'T')).toEqual({ mode: 'logo', title: 'T' })
  expect(screenFor({ slide: null, overlay: 'none' }, decks, 'T')).toEqual({
    mode: 'logo',
    title: 'T',
  })
  expect(screenFor({ slide: { deckId: 'x', index: 0 }, overlay: 'none' }, decks, 'T').mode).toBe(
    'logo',
  )
})
