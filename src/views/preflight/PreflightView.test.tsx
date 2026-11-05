import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { audioEngine } from '../../audio/engine'
import { soundLibrary } from '../../audio/library'
import type { Block, Sound } from '../../db/types'
import { tickStore } from '../../preflight/ticks'
import { audienceStore } from '../../store/audienceStore'
import { workshopStore } from '../../store/workshopStore'
import { PreflightView } from './PreflightView'

beforeAll(async () => {
  await workshopStore.getState().init()
})

beforeEach(() => {
  tickStore.setState({ ticks: {} })
  audienceStore.setState({ connected: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

let counter = 0
function block(id: string, title: string, script = ''): Block {
  return { id, title, kind: 'talk', durationMin: 10, goal: '', notes: '', script }
}

function sound(id: string, name: string): Sound {
  return {
    id,
    workshopId: '',
    name,
    kind: 'sfx',
    blob: new Blob([id], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
  }
}

async function setup(blocks: Block[], sounds: Sound[] = []) {
  counter += 1
  await workshopStore.getState().createWorkshop(`Pre-flight test ${counter}`)
  await workshopStore.getState().updateCurrent({ blocks })
  const workshopId = workshopStore.getState().currentId ?? ''
  workshopStore.setState({
    media: {
      decks: [{ id: 'd1', name: 'Deck', slideCount: 3 }],
      sounds: sounds.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    },
  })
  soundLibrary.setState({ workshopId, sounds, failed: false })
  return workshopId
}

function check(id: string) {
  return screen.getByTestId(`check-${id}`)
}

test('shows live checks for the audience window, slides, cues and sounds', async () => {
  const checkSound = vi
    .spyOn(audioEngine, 'checkSound')
    .mockImplementation(async (s) => (s.id === 'bad' ? 'This file could not be read.' : null))
  await setup(
    [block('a', 'Welcome', 'Hi [SLIDE 2] [SFX applause]\n[SLIDE 7]')],
    [sound('ok', 'Applause'), sound('bad', 'Gong')],
  )
  render(<PreflightView />)
  expect(screen.getByRole('heading', { name: 'Pre-flight', level: 1 })).toBeInTheDocument()

  expect(check('audience')).toHaveAttribute('data-status', 'fail')
  expect(check('slides')).toHaveTextContent('3 slides in 1 deck.')
  expect(check('cues')).toHaveAttribute('data-status', 'fail')
  expect(
    within(screen.getByRole('list', { name: 'Cue problems' })).getByRole('listitem'),
  ).toHaveTextContent(
    'Welcome, line 2: [SLIDE 7]. There is no slide 7. This workshop has 3 slides.',
  )

  expect(await screen.findByText('Gong: This file could not be read.')).toBeInTheDocument()
  expect(check('sounds')).toHaveAttribute('data-status', 'fail')
  expect(checkSound).toHaveBeenCalledTimes(2)

  // The button stays when the window connects, so keyboard focus is not lost.
  const open = screen.getByRole('button', { name: 'Open the audience window' })
  open.focus()
  act(() => audienceStore.setState({ connected: true }))
  expect(check('audience')).toHaveAttribute('data-status', 'ok')
  expect(open).toHaveAccessibleName('Show the audience window')
  expect(open).toHaveFocus()
})

test('checking sounds again decodes them again', async () => {
  const user = userEvent.setup()
  const checkSound = vi.spyOn(audioEngine, 'checkSound').mockResolvedValue(null)
  await setup([], [sound('a', 'Applause')])
  render(<PreflightView />)
  expect(await screen.findByText('The one sound plays.')).toBeInTheDocument()
  const again = screen.getByRole('button', { name: 'Check sounds again' })
  again.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByText('The one sound plays.')).toBeInTheDocument()
  expect(checkSound).toHaveBeenCalledTimes(2)
  expect(again).toHaveFocus()
})

test('the test tone button plays the beep through the engine', async () => {
  const user = userEvent.setup()
  const playTestTone = vi.spyOn(audioEngine, 'playTestTone').mockResolvedValue(true)
  await setup([])
  render(<PreflightView />)
  await user.click(screen.getByRole('button', { name: 'Play test tone' }))
  expect(playTestTone).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('checkbox', { name: 'I heard the test tone' })).not.toBeChecked()
})

test('a silent master volume shows a warning', async () => {
  vi.spyOn(audioEngine, 'getSnapshot').mockReturnValue({
    playing: {},
    loading: [],
    master: 0,
    error: null,
    testTone: false,
  })
  await setup([])
  render(<PreflightView />)
  expect(screen.getByText(/The master volume is at 0/)).toBeInTheDocument()
})

test('ticks count toward ready and are remembered per workshop', async () => {
  const user = userEvent.setup()
  vi.spyOn(audioEngine, 'checkSound').mockResolvedValue(null)
  const first = await setup([block('a', 'Welcome', '[SLIDE 1]')])
  audienceStore.setState({ connected: true })
  const { unmount } = render(<PreflightView />)
  const progress = screen.getByTestId('preflight-progress')
  expect(progress).toHaveTextContent('4 of 8 done.')

  const share = screen.getByRole('checkbox', { name: 'Click Share screen in Zoom' })
  expect(share).toHaveAccessibleDescription('It is the green button in the Zoom meeting toolbar.')
  for (const name of [
    'I heard the test tone',
    'Click Share screen in Zoom',
    'Pick the "PlanOnMe Audience" window',
    'Tick "Share sound"',
  ]) {
    await user.click(screen.getByRole('checkbox', { name }))
  }
  expect(progress).toHaveTextContent('All set. You are ready to go live.')
  // The optional video tick does not change the count.
  await user.click(
    screen.getByRole('checkbox', { name: 'Tick "Optimize for video clip" (optional)' }),
  )
  expect(progress).toHaveTextContent('All set.')
  unmount()

  // Another workshop starts with no ticks.
  await setup([])
  render(<PreflightView />)
  expect(screen.getByRole('checkbox', { name: 'Click Share screen in Zoom' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Clear ticks' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(tickStore.getState().ticks[first]).toHaveLength(5)

  // Going back shows its ticks again, and Clear ticks empties them.
  await act(() => workshopStore.getState().selectWorkshop(first))
  expect(screen.getByRole('checkbox', { name: 'Click Share screen in Zoom' })).toBeChecked()
  // Keyboard only: focus stays on Clear ticks after it empties the list.
  const clear = screen.getByRole('button', { name: 'Clear ticks' })
  clear.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('checkbox', { name: 'Click Share screen in Zoom' })).not.toBeChecked()
  expect(clear).toHaveFocus()
  expect(clear).toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Enter}')
  expect(tickStore.getState().ticks[first]).toBeUndefined()
})

test('explains how to resize the audience window', async () => {
  await setup([])
  render(<PreflightView />)
  expect(screen.getByRole('heading', { name: 'Audience window size' })).toBeInTheDocument()
  expect(screen.getByText(/It never goes full screen/)).toBeInTheDocument()
})
