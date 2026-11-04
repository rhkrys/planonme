import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { audienceStore } from '../store/audienceStore'
import { AUDIENCE_WINDOW_FEATURES, AUDIENCE_WINDOW_NAME, resetAudienceWindow } from '../sync/popup'
import { AudienceBar, PopupBlockedHelp } from './AudienceBar'

afterEach(() => {
  resetAudienceWindow()
  audienceStore.setState({ popupBlocked: false, connected: false })
  vi.restoreAllMocks()
})

function renderBar() {
  return render(
    <>
      <PopupBlockedHelp />
      <AudienceBar />
    </>,
  )
}

test('opens the popup once and then brings it to the front', async () => {
  const focus = vi.fn()
  const fake = { closed: false, focus } as unknown as Window
  const open = vi.spyOn(window, 'open').mockReturnValue(fake)
  renderBar()
  expect(screen.getByTestId('audience-connection')).toHaveTextContent('Not connected')
  const button = screen.getByRole('button', { name: 'Open audience window' })
  await userEvent.click(button)
  expect(open).toHaveBeenCalledWith(
    '/audience.html',
    AUDIENCE_WINDOW_NAME,
    AUDIENCE_WINDOW_FEATURES,
  )
  await userEvent.click(button)
  expect(open).toHaveBeenCalledTimes(1)
  expect(focus).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a blocked popup shows how to allow it', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  renderBar()
  await userEvent.click(screen.getByRole('button', { name: 'Open audience window' }))
  expect(screen.getByRole('alert')).toHaveTextContent('The browser blocked the audience window.')
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a popup call that throws counts as blocked', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(window, 'open').mockImplementation(() => {
    throw new Error('nope')
  })
  renderBar()
  await userEvent.click(screen.getByRole('button', { name: 'Open audience window' }))
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

test('shows when the audience window is connected', () => {
  audienceStore.setState({ connected: true })
  renderBar()
  expect(screen.getByTestId('audience-connection')).toHaveTextContent('Connected')
})
