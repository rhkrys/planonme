import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { audioEngine } from '../audio/engine'

afterEach(() => {
  vi.restoreAllMocks()
})

test('the ? key and the sidebar button open the shortcut list, and Esc closes it', async () => {
  const stopAll = vi.spyOn(audioEngine, 'stopAll')
  render(<App />)
  const button = screen.getByRole('button', { name: /^Keyboard shortcuts/ })

  button.focus()
  await userEvent.keyboard('?')
  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
  expect(dialog).toHaveTextContent('GO: fire the next cue')
  expect(dialog).toHaveTextContent('Blank screen on or off')
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

  // Esc closes the list and does not stop the sounds as well.
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(stopAll).not.toHaveBeenCalled()
  expect(button).toHaveFocus()

  await userEvent.click(button)
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  // Keys pressed in the dialog stay there: a number key does not switch views.
  await userEvent.keyboard('2')
  expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-current', 'page')
  // Tab stays inside the dialog.
  await userEvent.tab()
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('number keys open the views, but not while typing', async () => {
  render(<App />)
  const sidebar = screen.getByRole('navigation', { name: 'Main' })
  screen.getByRole('button', { name: 'Plan' }).focus()
  await userEvent.keyboard('2')
  expect(screen.getByRole('heading', { name: 'Script', level: 1 })).toBeInTheDocument()
  await userEvent.keyboard('6')
  expect(screen.getByRole('heading', { name: 'Run', level: 1 })).toBeInTheDocument()
  await userEvent.keyboard('1')
  expect(screen.getByRole('heading', { name: 'Plan', level: 1 })).toBeInTheDocument()
  expect(sidebar).toBeInTheDocument()

  const title = await screen.findByRole('textbox', { name: 'Workshop title' })
  await userEvent.click(title)
  await userEvent.keyboard('3')
  await waitFor(() => expect((title as HTMLInputElement).value.endsWith('3')).toBe(true))
  expect(screen.getByRole('heading', { name: 'Plan', level: 1 })).toBeInTheDocument()
})

test('keys pressed outside the open dialog do not reach the app', async () => {
  const stopAll = vi.spyOn(audioEngine, 'stopAll')
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /^Keyboard shortcuts/ }))
  screen.getByRole('dialog', { name: 'Keyboard shortcuts' })

  // Focus lands on the page body, for example after a click on plain text.
  ;(document.activeElement as HTMLElement | null)?.blur()
  expect(document.body).toHaveFocus()
  await userEvent.keyboard('2')
  expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

  ;(document.activeElement as HTMLElement | null)?.blur()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(stopAll).not.toHaveBeenCalled()
})
