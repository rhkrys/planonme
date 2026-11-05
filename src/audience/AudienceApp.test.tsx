import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFakeBus, last } from '../test/fakeChannel'
import type { SyncMessage } from '../sync/protocol'
import { AudienceApp, CURSOR_IDLE_MS } from './AudienceApp'
import { checkSlideBlob, SlideMissingError, type LoadSlide } from './slideSource'

beforeEach(() => {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:test/${blob.size}`)
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function png(size = 10): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/png' })
}

function setup(loadSlide: LoadSlide = async (_deck, index) => png(index + 1)) {
  const bus = createFakeBus()
  const control = bus.endpoint()
  const received: SyncMessage[] = []
  control.listen((m) => received.push(m))
  const audience = bus.endpoint()
  const view = render(<AudienceApp channel={audience} loadSlide={loadSlide} />)
  const send = async (m: SyncMessage | unknown) => {
    await act(async () => {
      if (typeof m === 'object' && m && 'from' in m) control.post(m as SyncMessage)
      else bus.inject(m)
      await new Promise((r) => setTimeout(r, 0))
    })
  }
  const statuses = () => received.filter((m) => m.from === 'audience' && m.type === 'status')
  return { control, received, send, statuses, view }
}

test('waits for the control window, then shows slides, blank and logo', async () => {
  const t = setup()
  expect(screen.getByText('Waiting for PlanOnMe')).toBeInTheDocument()
  await act(async () => {})
  expect(t.received).toContainEqual({ v: 1, from: 'audience', type: 'hello' })

  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: 'd', index: 1, number: 5 },
  })
  const img = screen.getByRole('img', { name: 'Slide 5' })
  expect(img).toHaveAttribute('src', 'blob:test/2')
  expect(last(t.statuses())).toMatchObject({
    screen: { mode: 'slide', index: 1 },
    problem: null,
  })

  await t.send({ v: 1, from: 'control', type: 'show', screen: { mode: 'blank' } })
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByTestId('audience-blank')).toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/2')

  await t.send({ v: 1, from: 'control', type: 'show', screen: { mode: 'logo', title: 'Hi all' } })
  expect(screen.getByTestId('audience-logo')).toHaveTextContent('Hi all')

  // No buttons or other controls for the audience to see.
  expect(screen.queryByRole('button')).toBeNull()
})

test('answers hello with what it shows and ignores junk', async () => {
  const t = setup()
  await t.send({ v: 1, from: 'control', type: 'show', screen: { mode: 'blank' } })
  const before = t.statuses().length
  await t.send({ v: 1, from: 'control', type: 'hello' })
  expect(t.statuses()).toHaveLength(before + 1)
  expect(last(t.statuses())).toMatchObject({ screen: { mode: 'blank' } })

  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: '', index: 0 },
  })
  await t.send('<script>')
  await t.send({ v: 9, from: 'control', type: 'show', screen: { mode: 'logo', title: 'x' } })
  expect(screen.getByTestId('audience-blank')).toBeInTheDocument()
})

test('a missing or broken slide is reported and does not crash', async () => {
  const t = setup(async (deckId) => {
    if (deckId === 'gone') throw new SlideMissingError()
    throw new Error('disk on fire')
  })
  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: 'gone', index: 0, number: 1 },
  })
  expect(screen.getByText('This slide could not be shown.')).toBeInTheDocument()
  expect(last(t.statuses())).toMatchObject({ problem: 'missing' })
  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: 'bad', index: 0, number: 1 },
  })
  expect(last(t.statuses())).toMatchObject({ problem: 'error' })
})

test('a slow slide does not replace a newer one', async () => {
  let release: (b: Blob) => void = () => {}
  const t = setup((deckId) =>
    deckId === 'slow' ? new Promise<Blob>((r) => (release = r)) : Promise.resolve(png(3)),
  )
  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: 'slow', index: 0, number: 1 },
  })
  await t.send({
    v: 1,
    from: 'control',
    type: 'show',
    screen: { mode: 'slide', deckId: 'fast', index: 0, number: 2 },
  })
  await act(async () => release(png(99)))
  expect(screen.getByRole('img', { name: 'Slide 2' })).toHaveAttribute('src', 'blob:test/3')
})

test('says goodbye when the window closes', async () => {
  const t = setup()
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(t.received).toContainEqual({ v: 1, from: 'audience', type: 'bye' })
})

test('hides the pointer when it rests', () => {
  vi.useFakeTimers()
  try {
    setup()
    const main = screen.getByTestId('audience')
    expect(main).not.toHaveClass('idle')
    act(() => vi.advanceTimersByTime(CURSOR_IDLE_MS + 10))
    expect(main).toHaveClass('idle')
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'))
    })
    expect(main).not.toHaveClass('idle')
  } finally {
    vi.useRealTimers()
  }
})

test('explains when the browser cannot link windows', () => {
  render(<AudienceApp channel={null} loadSlide={async () => png()} />)
  expect(screen.getByText('This browser cannot link the two windows.')).toBeInTheDocument()
})

test('only accepts slide images of a known type and size', () => {
  expect(checkSlideBlob(png())).toBeInstanceOf(Blob)
  expect(() => checkSlideBlob(new Blob(['x'], { type: 'text/html' }))).toThrow()
  expect(() => checkSlideBlob(new Blob([], { type: 'image/png' }))).toThrow()
})

test('a double click does not make the window full screen', async () => {
  const request = vi.fn(() => Promise.resolve())
  document.documentElement.requestFullscreen = request
  setup()
  await act(async () => {})
  await userEvent.dblClick(screen.getByTestId('audience'))
  expect(request).not.toHaveBeenCalled()
})
