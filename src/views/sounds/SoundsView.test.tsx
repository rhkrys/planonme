import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { audioEngine, DecodeError } from '../../audio/engine'
import { soundLibrary } from '../../audio/library'
import { useSoundKeys } from '../../audio/useSoundKeys'
import type { Sound } from '../../db/types'
import { makeWav } from '../../test/media'
import { workshopStore, type WorkshopState } from '../../store/workshopStore'
import { SoundsView } from './SoundsView'

const realActions: Partial<WorkshopState> = {}

beforeAll(async () => {
  await workshopStore.getState().init()
  const s = workshopStore.getState()
  Object.assign(realActions, {
    addSound: s.addSound,
    updateSound: s.updateSound,
    deleteSound: s.deleteSound,
  })
})

let currentId = ''

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  currentId = workshopStore.getState().currentId ?? ''
  vi.spyOn(audioEngine, 'play').mockResolvedValue(true)
  vi.spyOn(audioEngine, 'stopAll').mockImplementation(() => {})
  vi.spyOn(audioEngine, 'prime').mockImplementation(() => {})
})

afterEach(() => {
  workshopStore.setState({ ...realActions, error: null, notice: null })
  soundLibrary.setState({ workshopId: null, sounds: null, failed: false })
  vi.restoreAllMocks()
})

function sound(id: string, name: string, patch: Partial<Sound> = {}): Sound {
  return {
    id,
    workshopId: currentId,
    name,
    kind: 'sfx',
    blob: new Blob(['x'], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
    ...patch,
  }
}

function showSounds(sounds: Sound[]) {
  soundLibrary.setState({ workshopId: currentId, sounds, failed: false })
}

function Keys() {
  useSoundKeys()
  return <input aria-label="Some field" />
}

test('shows the empty state and the upload controls', () => {
  showSounds([])
  render(<SoundsView />)
  expect(screen.getByText(/No sounds yet/)).toBeInTheDocument()
  expect(screen.getByLabelText('Choose audio files')).toBeEnabled()
  expect(screen.getByRole('combobox', { name: 'Add as' })).toHaveValue('auto')
  expect(screen.getByRole('slider', { name: 'Master volume' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Stop all (Esc)' })).toBeInTheDocument()
})

test('the file button waits for sounds to load', () => {
  render(<SoundsView />)
  expect(screen.getByText('Loading sounds...')).toBeInTheDocument()
  expect(screen.getByLabelText('Choose audio files')).toBeDisabled()
})

test('pads show name, kind, key and color, and play on click', async () => {
  showSounds([
    sound('1', 'Applause', { hotkey: 'a', color: '#e5484d' }),
    sound('2', 'Lounge', { kind: 'music', loop: true, volume: 0.5 }),
  ])
  render(<SoundsView />)
  const pads = screen.getAllByTestId('pad')
  expect(pads).toHaveLength(2)
  expect(pads[0]).toHaveTextContent('Applause')
  expect(pads[0]).toHaveTextContent('Effect')
  expect(pads[0]).toHaveTextContent('A')
  expect(pads[0]?.getAttribute('style')).toContain('--pad-color: #e5484d')
  expect(pads[1]).toHaveTextContent('Music, loops, 50%')

  await userEvent.click(screen.getByRole('button', { name: 'Play Lounge' }))
  expect(audioEngine.play).toHaveBeenCalledWith('2', { toggle: true })
  await userEvent.click(screen.getByRole('button', { name: 'Stop all (Esc)' }))
  expect(audioEngine.stopAll).toHaveBeenCalled()
})

test('a playing sound shows its state', async () => {
  const s = sound('1', 'Applause')
  vi.spyOn(audioEngine, 'getSnapshot').mockReturnValue({
    playing: {
      '1': {
        soundId: '1',
        kind: 'sfx',
        count: 1,
        startedAt: 0,
        duration: 3,
        loop: false,
        stopping: false,
      },
    },
    loading: [],
    master: 0.7,
    error: 'Could not play "Gong".',
  })
  showSounds([s])
  render(<SoundsView />)
  const pad = screen.getByTestId('pad')
  expect(pad).toHaveAttribute('data-playing', 'true')
  expect(within(pad).getByTestId('pad-state')).toHaveTextContent('Playing')
  // Screen readers hear the state too, not only the pad name.
  expect(screen.getByRole('button', { name: 'Play Applause' })).toHaveAccessibleDescription(
    'Playing',
  )
  expect(screen.getByTestId('playing-count')).toHaveTextContent('1 sound playing')
  expect(screen.getByRole('slider', { name: 'Master volume' })).toHaveValue('70')
  expect(screen.getByRole('alert')).toHaveTextContent('Could not play "Gong".')
})

test('hotkeys play pads, Escape stops all, and typing in a field does neither', async () => {
  showSounds([sound('1', 'Applause', { hotkey: 'a' }), sound('2', 'Gong', { hotkey: 'g' })])
  render(<Keys />)
  await userEvent.keyboard('A')
  expect(audioEngine.play).toHaveBeenCalledWith('1', { toggle: true })
  await userEvent.keyboard('g')
  expect(audioEngine.play).toHaveBeenCalledWith('2', { toggle: true })
  await userEvent.keyboard('{Escape}')
  expect(audioEngine.stopAll).toHaveBeenCalledTimes(1)
  // Keys held down do not repeat the sound.
  fireEvent.keyDown(window, { key: 'a', repeat: true })
  // Keys with a modifier belong to the browser.
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
  expect(audioEngine.play).toHaveBeenCalledTimes(2)

  await userEvent.type(screen.getByRole('textbox', { name: 'Some field' }), 'ag{Escape}')
  expect(audioEngine.play).toHaveBeenCalledTimes(2)
  expect(audioEngine.stopAll).toHaveBeenCalledTimes(1)
})

test('editing a sound checks the hotkey and saves the settings', async () => {
  const update = vi.fn(async () => true)
  workshopStore.setState({ updateSound: update })
  showSounds([sound('1', 'Applause', { hotkey: 'a' }), sound('2', 'Gong')])
  render(<SoundsView />)
  await userEvent.click(screen.getByRole('button', { name: 'Edit Gong' }))
  const form = screen.getByRole('form', { name: 'Edit sound Gong' })
  const hotkey = within(form).getByRole('textbox', { name: 'Hotkey' })
  const save = within(form).getByRole('button', { name: 'Save sound' })

  await userEvent.click(hotkey)
  await userEvent.keyboard('a')
  expect(within(form).getByText('"Applause" already uses this key.')).toBeInTheDocument()
  expect(save).toBeDisabled()
  await userEvent.keyboard('b')
  expect(within(form).getByText('B is kept for the blank screen.')).toBeInTheDocument()
  await userEvent.keyboard('{Backspace}')
  expect(hotkey).toHaveValue('')
  await userEvent.keyboard('G')
  expect(hotkey).toHaveValue('G')
  expect(save).toBeEnabled()

  const name = within(form).getByRole('textbox', { name: 'Sound name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'applause')
  expect(within(form).getByText('Another sound has this name.')).toBeInTheDocument()
  expect(save).toBeDisabled()
  await userEvent.clear(name)
  await userEvent.type(name, 'Big gong')

  await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Sound kind' }), 'music')
  await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Sound color' }), 'Blue')
  fireEvent.change(within(form).getByRole('slider', { name: 'Volume' }), {
    target: { value: '40' },
  })
  await userEvent.click(within(form).getByRole('checkbox', { name: 'Loop' }))
  await userEvent.click(save)
  expect(update).toHaveBeenCalledWith('2', {
    name: 'Big gong',
    kind: 'music',
    loop: true,
    volume: 0.4,
    hotkey: 'g',
    color: '#0090ff',
  })
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Edit Gong' })).toHaveFocus()
})

test('Escape in the edit form closes it without stopping sounds', async () => {
  showSounds([sound('1', 'Gong')])
  render(
    <>
      <Keys />
      <SoundsView />
    </>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Edit Gong' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  expect(audioEngine.stopAll).not.toHaveBeenCalled()
})

test('deleting a sound asks first', async () => {
  const del = vi.fn(async () => true)
  workshopStore.setState({ deleteSound: del })
  showSounds([sound('1', 'Gong'), sound('2', 'Bell')])
  render(<SoundsView />)
  await userEvent.click(screen.getByRole('button', { name: 'Delete Gong' }))
  const confirm = screen.getByRole('group', { name: 'Confirm delete sound Gong' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(del).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Delete Gong' }))
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('group', { name: 'Confirm delete sound Gong' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Delete Gong' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete sound' }))
  expect(del).toHaveBeenCalledWith('1')
})

test('uploads check type, size and decoding, and add the good files', async () => {
  const add = vi.fn(async (_id: string, s: Omit<Sound, 'id' | 'workshopId'>) => ({
    ...s,
    id: 'new',
    workshopId: currentId,
  }))
  workshopStore.setState({ addSound: add })
  vi.spyOn(audioEngine, 'probe').mockImplementation(async (blob: Blob) => {
    if (blob.size === 3) throw new DecodeError('This file could not be read as audio.')
    const buffer = { duration: blob.size > 10 ? 60 : 2, length: 1, numberOfChannels: 1 }
    return { duration: buffer.duration, buffer }
  })
  showSounds([])
  render(<SoundsView />)
  const files = [
    new File(['12345'], 'ding.wav', { type: 'audio/wav' }),
    new File(['a long track'], 'theme_song.mp3', { type: '' }),
    new File(['bad'], 'broken.wav', { type: 'audio/wav' }),
    new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    new File([], 'empty.wav', { type: 'audio/wav' }),
    // No type and no extension, but the bytes are a WAV file.
    new File([makeWav(0.01)], 'voice memo', { type: '' }),
  ]
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Choose audio files'), { target: { files } })
  })
  await waitFor(() => expect(workshopStore.getState().notice).toBe('Added 3 sounds.'))
  expect(add).toHaveBeenCalledTimes(3)
  expect(add.mock.calls[0]?.[1]).toMatchObject({ name: 'ding', kind: 'sfx', loop: false })
  expect(add.mock.calls[1]?.[1]).toMatchObject({ name: 'theme song', kind: 'music', loop: true })
  expect(add.mock.calls[1]?.[1].blob.type).toBe('audio/mpeg')
  expect(add.mock.calls[2]?.[1]).toMatchObject({ name: 'voice memo' })
  expect(add.mock.calls[2]?.[1].blob.type).toBe('audio/wav')
  expect(audioEngine.prime).toHaveBeenCalledTimes(3)
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('"broken.wav": This file could not be read as audio.')
  expect(alert).toHaveTextContent('"notes.txt" is not an audio file.')
  expect(alert).toHaveTextContent('"empty.wav" is empty.')
  await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('a failed save stops the upload', async () => {
  const add = vi.fn(async () => null)
  workshopStore.setState({ addSound: add })
  vi.spyOn(audioEngine, 'probe').mockResolvedValue({
    duration: 1,
    buffer: { duration: 1, length: 1, numberOfChannels: 1 },
  })
  showSounds([])
  render(<SoundsView />)
  const files = [
    new File(['1'], 'a.wav', { type: 'audio/wav' }),
    new File(['2'], 'b.wav', { type: 'audio/wav' }),
  ]
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Choose audio files'), { target: { files } })
  })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('"a.wav" was not added.'))
  expect(add).toHaveBeenCalledTimes(1)
})

test('dropped files are added, and hotkeys work while a slider has focus', async () => {
  const add = vi.fn(async (_id: string, s: Omit<Sound, 'id' | 'workshopId'>) => ({
    ...s,
    id: 'new',
    workshopId: currentId,
  }))
  workshopStore.setState({ addSound: add })
  vi.spyOn(audioEngine, 'probe').mockResolvedValue({
    duration: 1,
    buffer: { duration: 1, length: 1, numberOfChannels: 1 },
  })
  showSounds([sound('1', 'Applause', { hotkey: 'a' })])
  render(
    <>
      <Keys />
      <SoundsView />
    </>,
  )
  const file = new File(['1'], 'drop.wav', { type: 'audio/wav' })
  await act(async () => {
    fireEvent.drop(screen.getByTestId('sound-drop-zone'), {
      dataTransfer: { files: [file], types: ['Files'] },
    })
  })
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
  expect(add.mock.calls[0]?.[1]).toMatchObject({ name: 'drop' })

  screen.getByRole('slider', { name: 'Master volume' }).focus()
  await userEvent.keyboard('a')
  expect(audioEngine.play).toHaveBeenCalledWith('1', { toggle: true })
})
