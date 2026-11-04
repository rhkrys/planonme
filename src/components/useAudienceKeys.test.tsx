import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAudienceStore } from '../store/audienceStore'
import { useAudienceKeys } from './useAudienceKeys'

function setup() {
  const store = createAudienceStore(() => [{ id: 'a', slideCount: 3 }])
  renderHook(() => useAudienceKeys(store))
  return store
}

test('arrow keys, page keys, B and L control the audience screen', async () => {
  const store = setup()
  await userEvent.keyboard('{ArrowRight}')
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 0 })
  await userEvent.keyboard('{ArrowRight}{PageDown}')
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 2 })
  await userEvent.keyboard('{ArrowLeft}')
  expect(store.getState().slide).toEqual({ deckId: 'a', index: 1 })
  await userEvent.keyboard('b')
  expect(store.getState().overlay).toBe('blank')
  await userEvent.keyboard('B')
  expect(store.getState().overlay).toBe('none')
  await userEvent.keyboard('l')
  expect(store.getState().overlay).toBe('logo')
  await userEvent.keyboard('{PageUp}')
  expect(store.getState()).toMatchObject({ overlay: 'none', slide: { index: 1 } })
})

test('keys typed into a field or with a modifier are left alone', async () => {
  const store = setup()
  render(
    <>
      <input aria-label="Name" />
      <textarea aria-label="Notes" />
    </>,
  )
  await userEvent.click(screen.getByRole('textbox', { name: 'Name' }))
  await userEvent.keyboard('b{ArrowRight}')
  await userEvent.click(screen.getByRole('textbox', { name: 'Notes' }))
  await userEvent.keyboard('l{ArrowRight}')
  expect(store.getState()).toMatchObject({ overlay: 'none', slide: null })
  ;(document.activeElement as HTMLElement).blur()
  await userEvent.keyboard('{Control>}{ArrowRight}{/Control}{Alt>}b{/Alt}')
  expect(store.getState()).toMatchObject({ overlay: 'none', slide: null })
})
