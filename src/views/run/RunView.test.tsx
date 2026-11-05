import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { audioEngine } from '../../audio/engine'
import type { Block } from '../../db/types'
import { runStore } from '../../run/runStore'
import { audienceStore } from '../../store/audienceStore'
import { workshopStore } from '../../store/workshopStore'
import { RunView } from './RunView'

beforeAll(async () => {
  await workshopStore.getState().init()
})

afterEach(() => {
  vi.restoreAllMocks()
})

let counter = 0
function block(id: string, title: string, script = '', durationMin = 10): Block {
  return { id, title, kind: 'talk', durationMin, goal: '', notes: '', script }
}

async function setup(blocks: Block[]) {
  counter += 1
  await workshopStore.getState().createWorkshop(`Run test ${counter}`)
  await workshopStore.getState().updateCurrent({ blocks })
  workshopStore.setState({
    media: {
      decks: [
        { id: 'd1', name: 'Intro deck', slideCount: 2 },
        { id: 'd2', name: 'Main deck', slideCount: 3 },
      ],
      sounds: [{ id: 's1', name: 'Applause', kind: 'sfx' }],
    },
  })
  const playCue = vi.spyOn(audioEngine, 'playCue').mockResolvedValue(true)
  return { playCue }
}

function audienceSlide() {
  return audienceStore.getState().slide
}

test('asks for blocks when the workshop has none', async () => {
  await setup([])
  render(<RunView />)
  expect(screen.getByRole('heading', { name: 'Run', level: 1 })).toBeInTheDocument()
  expect(screen.getByText('This workshop has no blocks yet. Add them in Plan.')).toBeVisible()
})

test('space fires cues in order, shift+space steps back without replaying sounds', async () => {
  const user = userEvent.setup()
  const { playCue } = await setup([
    block('a', 'Welcome', 'Hello. [SLIDE 1] Clap now [SFX applause]'),
    block('b', 'Main part', 'Here we go [SLIDE 4] [SFX gong] [TIMER 2m]'),
  ])
  render(<RunView />)
  const prompter = await screen.findByRole('region', { name: 'Teleprompter' })
  expect(within(prompter).getAllByTestId('run-cue')).toHaveLength(4)
  expect(within(prompter).getByTestId('run-cue-bad')).toHaveTextContent('[SFX gong]')
  expect(screen.getByTestId('next-cue')).toHaveTextContent('[SLIDE 1] Slide 1: Intro deck')
  expect(screen.getByTestId('schedule-status')).toHaveTextContent('Not started')

  await user.keyboard(' ')
  expect(audienceSlide()).toEqual({ deckId: 'd1', index: 0 })
  expect(screen.getByRole('button', { name: /^Jump to \[SLIDE 1\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )
  expect(screen.getByRole('button', { name: 'Pause session' })).toBeInTheDocument()

  await user.keyboard(' ')
  expect(playCue).toHaveBeenCalledTimes(1)
  expect(playCue).toHaveBeenCalledWith({ type: 'sfx', name: 'applause' })

  await user.keyboard(' ')
  expect(audienceSlide()).toEqual({ deckId: 'd2', index: 1 })
  expect(screen.getByRole('region', { name: 'Main part' })).toHaveTextContent('Now')

  // The unknown sound is skipped with a note, and the timer starts.
  await user.keyboard(' ')
  expect(screen.getByTestId('run-note')).toHaveTextContent(
    'Skipped [SFX gong]. There is no sound named "gong".',
  )
  expect(screen.getByTestId('run-timer')).toHaveTextContent('2:00')
  expect(screen.getByTestId('next-cue')).toHaveTextContent('No more cues.')

  // Back twice: over the slide, to the sound, which does not play again.
  await user.keyboard('{Shift>} {/Shift}')
  await user.keyboard('{Shift>} {/Shift}')
  expect(audienceSlide()).toEqual({ deckId: 'd1', index: 0 })
  expect(playCue).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: /^Jump to \[SFX applause\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )

  // The Back button does the same.
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('button', { name: /^Jump to \[SLIDE 1\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )
})

test('keys do not fire while typing, and a focused button does not swallow GO', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Start', '[SLIDE 2] [SLIDE 3]')])
  render(
    <>
      <input aria-label="Notes" />
      <RunView />
    </>,
  )
  await screen.findByRole('region', { name: 'Teleprompter' })
  await user.click(screen.getByRole('textbox', { name: 'Notes' }))
  await user.keyboard(' ')
  expect(runStore.getState().pos.cue).toBe(-1)

  // Space on the focused Reset button runs GO instead of a reset.
  await user.click(screen.getByRole('button', { name: 'Reset session' }))
  await user.keyboard(' ')
  expect(runStore.getState().pos.cue).toBe(0)
  await user.keyboard(' ')
  expect(runStore.getState().pos.cue).toBe(1)
  expect(audienceSlide()).toEqual({ deckId: 'd2', index: 0 })
})

test('clicking a cue jumps to it and a block can be started', async () => {
  const user = userEvent.setup()
  const { playCue } = await setup([
    block('a', 'Intro', '[SLIDE 1] [SFX applause]'),
    block('b', 'Break', '  '),
    block('c', 'Outro', '[SLIDE 5]'),
  ])
  render(<RunView />)
  await screen.findByRole('region', { name: 'Teleprompter' })

  await user.click(screen.getByRole('button', { name: /^Jump to \[SFX applause\]/ }))
  expect(playCue).not.toHaveBeenCalled()
  expect(audienceSlide()).toEqual({ deckId: 'd1', index: 0 })
  expect(screen.getByRole('img', { name: 'Next slide: slide 5' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Start block Break' }))
  expect(screen.getByRole('region', { name: 'Break' })).toHaveTextContent('Now')
  expect(screen.getByText('No script for this block.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Next block' }))
  expect(screen.getByRole('region', { name: 'Outro' })).toHaveTextContent('Now')
  expect(screen.getByRole('button', { name: 'Next block' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'GO' }))
  expect(audienceSlide()).toEqual({ deckId: 'd2', index: 2 })
})

test('shows the session clocks and changes the text size', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  try {
    await setup([block('a', 'Short', '[SLIDE 1]', 1), block('b', 'Long', '[SLIDE 2]', 10)])
    render(<RunView />)
    await screen.findByRole('region', { name: 'Teleprompter' })
    expect(screen.getByTestId('block-countdown')).toHaveTextContent('1:00')
    act(() => screen.getByRole('button', { name: 'Start session' }).click())
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(screen.getByTestId('elapsed')).toHaveTextContent('1:30')
    expect(screen.getByTestId('block-countdown')).toHaveTextContent('0:30 over')
    expect(screen.getByTestId('schedule-status')).toHaveTextContent('0:30 behind')
    act(() => screen.getByRole('button', { name: 'Pause session' }).click())
    expect(screen.getByText('Elapsed (paused)')).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Reset session' }).click())
    expect(screen.getByTestId('elapsed')).toHaveTextContent('0:00')
  } finally {
    vi.useRealTimers()
  }

  const user = userEvent.setup()
  const size = screen.getByTestId('run-font-size').textContent
  await user.click(screen.getByRole('button', { name: 'Larger text' }))
  expect(screen.getByTestId('run-font-size').textContent).not.toBe(size)
  expect(screen.getByRole('region', { name: 'Teleprompter' }).style.fontSize).toBe(
    screen.getByTestId('run-font-size').textContent?.replace(' ', ''),
  )
})
