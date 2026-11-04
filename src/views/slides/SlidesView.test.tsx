import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SlideDeck } from '../../db/types'
import * as pipeline from '../../slides/importPdf'
import { workshopStore, type WorkshopState } from '../../store/workshopStore'
import { SlidesView } from './SlidesView'

vi.mock('../../slides/importPdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../slides/importPdf')>()
  return { ...actual, importPdf: vi.fn(actual.importPdf) }
})

const realActions: Partial<WorkshopState> = {}

beforeAll(async () => {
  await workshopStore.getState().init()
  const s = workshopStore.getState()
  Object.assign(realActions, {
    loadSlideDecks: s.loadSlideDecks,
    addSlideDeck: s.addSlideDeck,
    renameSlideDeck: s.renameSlideDeck,
    deleteSlideDeck: s.deleteSlideDeck,
    moveSlideDeck: s.moveSlideDeck,
  })
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:test/${blob.size}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  workshopStore.setState({ ...realActions, error: null, notice: null })
  vi.mocked(pipeline.importPdf).mockClear()
  vi.restoreAllMocks()
})

function deck(id: string, name: string, count: number): SlideDeck {
  const slides = Array.from({ length: count }, () => new Blob(['x'], { type: 'image/png' }))
  return { id, workshopId: 'w', name, source: 'pdf', slides }
}

function pdfFile(name = 'Talk.pdf', text = '%PDF-1.7 fake'): File {
  return new File([text], name, { type: 'application/pdf' })
}

test('shows the empty state and the export help', async () => {
  workshopStore.setState({ loadSlideDecks: async () => [] })
  render(<SlidesView />)
  expect(await screen.findByText(/No slides yet/)).toBeInTheDocument()
  const help = screen.getByText('How to save your slides as a PDF')
  await userEvent.click(help)
  for (const tool of ['PowerPoint', 'Google Slides', 'Canva', 'Gamma']) {
    expect(screen.getByRole('heading', { name: tool })).toBeVisible()
  }
  expect(screen.getByText(/PDF document \(\.pdf\)/)).toBeInTheDocument()
})

test('a file that is not a PDF shows an error', async () => {
  workshopStore.setState({ loadSlideDecks: async () => [] })
  render(<SlidesView />)
  const input = await screen.findByLabelText('Choose PDF file')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.upload(input, pdfFile('notes.pdf', 'plain text'))
  expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a PDF.')
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('imports a PDF with progress and saves it under the chosen name and source', async () => {
  const added = vi.fn(async () => true)
  workshopStore.setState({ loadSlideDecks: async () => [], addSlideDeck: added })
  let finish: () => void = () => {}
  vi.mocked(pipeline.importPdf).mockImplementation(async (_file, options) => {
    options?.onProgress?.({ done: 0, total: 2 })
    options?.onProgress?.({ done: 1, total: 2 })
    await new Promise<void>((resolve) => (finish = resolve))
    options?.onProgress?.({ done: 2, total: 2 })
    return { slides: [new Blob(['a']), new Blob(['b'])] }
  })
  render(<SlidesView />)
  const input = await screen.findByLabelText('Choose PDF file')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.type(screen.getByRole('textbox', { name: 'Deck name' }), 'Main talk')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Made with' }), 'gslides')
  await userEvent.upload(input, pdfFile())

  expect(await screen.findByTestId('import-status')).toHaveTextContent('Rendering page 2 of 2')
  expect(screen.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute('value', '1')
  await act(async () => finish())

  await waitFor(() => expect(added).toHaveBeenCalledTimes(1))
  expect(added).toHaveBeenCalledWith(workshopStore.getState().currentId, {
    name: 'Main talk',
    source: 'gslides',
    slides: [expect.any(Blob), expect.any(Blob)],
  })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Deck name' })).toHaveValue(''))
  expect(screen.getByLabelText('Choose PDF file')).toBeEnabled()
})

test('cancel stops the import and says so', async () => {
  const added = vi.fn(async () => true)
  workshopStore.setState({ loadSlideDecks: async () => [], addSlideDeck: added })
  vi.mocked(pipeline.importPdf).mockImplementation(
    (_file, options) =>
      new Promise((_resolve, reject) => {
        options?.onProgress?.({ done: 0, total: 0 })
        options?.signal?.addEventListener('abort', () =>
          reject(new pipeline.SlideImportCancelled()),
        )
      }),
  )
  render(<SlidesView />)
  const input = await screen.findByLabelText('Choose PDF file')
  await waitFor(() => expect(input).toBeEnabled())
  await userEvent.upload(input, pdfFile())
  expect(await screen.findByTestId('import-status')).toHaveTextContent('Opening PDF...')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Import cancelled.')
  expect(added).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Choose PDF file')).toBeEnabled()
})

test('lists decks with global slide numbers and edits them', async () => {
  const decks = [deck('d1', 'Intro', 2), deck('d2', 'Main', 3)]
  const move = vi.fn(async () => true)
  const rename = vi.fn(async () => true)
  const remove = vi.fn(async () => true)
  workshopStore.setState({
    loadSlideDecks: async () => decks,
    moveSlideDeck: move,
    renameSlideDeck: rename,
    deleteSlideDeck: remove,
  })
  render(<SlidesView />)

  const main = await screen.findByRole('list', { name: 'Slides in Main' })
  await waitFor(() =>
    expect(
      within(main)
        .getAllByRole('img')
        .map((img) => `${img.tagName} ${img.getAttribute('alt')}`),
    ).toEqual(['IMG Slide 3', 'IMG Slide 4', 'IMG Slide 5']),
  )
  expect(screen.getByText(/Slides 1 to 2/)).toBeInTheDocument()
  expect(screen.getByText(/Slides 3 to 5/)).toBeInTheDocument()

  expect(screen.getByRole('button', { name: 'Move Intro up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move Main down' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Move Main up' }))
  expect(move).toHaveBeenCalledWith('d2', -1)

  await userEvent.click(screen.getByRole('button', { name: 'Rename Intro' }))
  const form = screen.getByRole('form', { name: 'Rename deck Intro' })
  const field = within(form).getByRole('textbox', { name: 'Deck name' })
  await userEvent.clear(field)
  await userEvent.type(field, 'Opening{Enter}')
  expect(rename).toHaveBeenCalledWith('d1', 'Opening')
  await waitFor(() => expect(screen.queryByRole('form', { name: /Rename deck/ })).toBeNull())

  await userEvent.click(screen.getByRole('button', { name: 'Delete Main' }))
  const confirm = screen.getByRole('group', { name: 'Confirm delete deck Main' })
  expect(confirm).toHaveTextContent('Delete "Main" and its 3 slides?')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(remove).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Delete Main' }))
  await userEvent.click(screen.getByRole('button', { name: 'Delete deck' }))
  expect(remove).toHaveBeenCalledWith('d2')
})

test('a slide image that cannot be shown gets a placeholder', async () => {
  workshopStore.setState({ loadSlideDecks: async () => [deck('d1', 'Broken', 1)] })
  render(<SlidesView />)
  await waitFor(() => expect(screen.getByRole('img', { name: 'Slide 1' }).tagName).toBe('IMG'))
  const img = screen.getByRole('img', { name: 'Slide 1' })
  act(() => {
    img.dispatchEvent(new Event('error'))
  })
  expect(await screen.findByText('Cannot show')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Slide 1' })).toBeInTheDocument()
})

test('a failed load shows an error', async () => {
  workshopStore.setState({ loadSlideDecks: async () => null })
  render(<SlidesView />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the slides.')
})

test('two files dropped quickly start only one import', async () => {
  workshopStore.setState({ loadSlideDecks: async () => [], addSlideDeck: async () => true })
  vi.mocked(pipeline.importPdf).mockImplementation(() => new Promise(() => {}))
  render(<SlidesView />)
  await waitFor(() => expect(screen.getByLabelText('Choose PDF file')).toBeEnabled())
  const zone = screen.getByTestId('drop-zone')
  const drop = () => {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [pdfFile()], types: ['Files'] },
    })
    zone.dispatchEvent(event)
  }
  act(() => {
    drop()
    drop()
  })
  expect(await screen.findByTestId('import-status')).toBeInTheDocument()
  expect(pipeline.importPdf).toHaveBeenCalledTimes(1)
})

test('decks of the previous workshop are not shown while the next one loads', async () => {
  const first = workshopStore.getState().currentId
  workshopStore.setState({ loadSlideDecks: async () => [deck('d1', 'Old deck', 2)] })
  render(<SlidesView />)
  expect(await screen.findByRole('heading', { name: 'Old deck' })).toBeInTheDocument()

  let finish: (decks: SlideDeck[]) => void = () => {}
  workshopStore.setState({
    loadSlideDecks: () => new Promise<SlideDeck[]>((resolve) => (finish = resolve)),
  })
  act(() => workshopStore.setState({ currentId: 'other-workshop' }))
  expect(screen.queryByRole('heading', { name: 'Old deck' })).toBeNull()
  expect(screen.getByText('Loading slides...')).toBeInTheDocument()
  expect(screen.getByLabelText('Choose PDF file')).toBeDisabled()
  await act(async () => finish([deck('d2', 'New deck', 1)]))
  expect(await screen.findByRole('heading', { name: 'New deck' })).toBeInTheDocument()
  act(() => workshopStore.setState({ currentId: first }))
})

test('focus goes back to the deck buttons after a move, a cancel and a delete', async () => {
  let decks = [deck('d1', 'Intro', 2), deck('d2', 'Main', 3)]
  workshopStore.setState({
    loadSlideDecks: async () => decks,
    moveSlideDeck: async () => {
      decks = [decks[1]!, decks[0]!]
      workshopStore.setState({ media: { decks: [], sounds: [] } })
      return true
    },
    deleteSlideDeck: async (id) => {
      decks = decks.filter((d) => d.id !== id)
      workshopStore.setState({ media: { decks: [], sounds: [] } })
      return true
    },
  })
  render(<SlidesView />)
  const down = await screen.findByRole('button', { name: 'Move Intro down' })
  down.focus()
  await userEvent.keyboard('{Enter}')
  // Intro is now last, so its down button is disabled and focus moves to its up button.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move Intro up' })).toHaveFocus())

  screen.getByRole('button', { name: 'Rename Intro' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('form', { name: 'Rename deck Intro' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Rename Intro' })).toHaveFocus()

  screen.getByRole('button', { name: 'Delete Main' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Delete Main' })).toHaveFocus()

  await userEvent.keyboard('{Enter}')
  await userEvent.click(screen.getByRole('button', { name: 'Delete deck' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Main' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Delete Intro' })).toHaveFocus()
})

test('clicking a slide shows it on the audience screen', async () => {
  const { audienceStore } = await import('../../store/audienceStore')
  const decks = [deck('d1', 'Intro', 2), deck('d2', 'Wrap', 1)]
  workshopStore.setState({
    loadSlideDecks: async () => decks,
    media: {
      decks: decks.map((d) => ({ id: d.id, name: d.name, slideCount: d.slides.length })),
      sounds: [],
    },
  })
  render(<SlidesView />)
  await userEvent.click(await screen.findByRole('button', { name: 'Show slide 3' }))
  expect(audienceStore.getState().slide).toEqual({ deckId: 'd2', index: 0 })
  expect(screen.getByRole('button', { name: 'Show slide 3' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByTestId('audience-now')).toHaveTextContent('Showing slide 3 of 3.')
  expect(screen.getByRole('img', { name: 'Audience preview: slide 3' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next slide' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Next slide' }))
  expect(screen.getByTestId('audience-now')).toHaveTextContent('Showing slide 3 of 3.')

  await userEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
  expect(screen.getByTestId('audience-now')).toHaveTextContent('Showing slide 2 of 3.')
  await userEvent.click(screen.getByRole('button', { name: 'Blank (B)' }))
  expect(screen.getByRole('img', { name: 'Audience preview: blank screen' })).toBeInTheDocument()
  await userEvent.keyboard('l')
  expect(screen.getByRole('button', { name: 'Logo (L)' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('audience-now')).toHaveTextContent('Logo screen is on.')
  audienceStore.setState({ slide: null, overlay: 'none' })
})

test('stepping to the first slide with the keyboard keeps focus on Previous', async () => {
  const { audienceStore } = await import('../../store/audienceStore')
  const decks = [deck('d1', 'Intro', 3)]
  workshopStore.setState({
    loadSlideDecks: async () => decks,
    media: { decks: [{ id: 'd1', name: 'Intro', slideCount: 3 }], sounds: [] },
  })
  audienceStore.setState({ slide: { deckId: 'd1', index: 1 }, overlay: 'none' })
  render(<SlidesView />)
  const previous = await screen.findByRole('button', { name: 'Previous slide' })
  previous.focus()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByTestId('audience-now')).toHaveTextContent('Showing slide 1 of 3.')
  expect(previous).toHaveAttribute('aria-disabled', 'true')
  expect(previous).toHaveFocus()
  // Pressing it again at the first slide does nothing.
  await userEvent.keyboard('{Enter}')
  expect(audienceStore.getState().slide).toEqual({ deckId: 'd1', index: 0 })
  audienceStore.setState({ slide: null, overlay: 'none' })
})

test('the thumbnail strip scrolls to keep the current slide in view', async () => {
  const { audienceStore } = await import('../../store/audienceStore')
  const indexOf = (el: HTMLElement) =>
    el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0
  const layout = [
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'LI' ? indexOf(this) * 100 : 0
    }),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(90),
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300),
  ]
  const decks = [deck('d1', 'Intro', 10)]
  workshopStore.setState({
    loadSlideDecks: async () => decks,
    media: { decks: [{ id: 'd1', name: 'Intro', slideCount: 10 }], sounds: [] },
  })
  audienceStore.setState({ slide: { deckId: 'd1', index: 0 }, overlay: 'none' })
  render(<SlidesView />)
  const strip = await screen.findByRole('list', { name: 'Slides in Intro' })
  expect(strip.scrollLeft).toBe(0)
  act(() => audienceStore.getState().showSlide({ deckId: 'd1', index: 7 }))
  // Slide 8 spans 700 to 790, so the strip scrolls until its right edge is in view.
  expect(strip.scrollLeft).toBe(490)
  act(() => audienceStore.getState().showSlide({ deckId: 'd1', index: 2 }))
  expect(strip.scrollLeft).toBe(200)
  layout.forEach((s) => s.mockRestore())
  audienceStore.setState({ slide: null, overlay: 'none' })
})

test('a file picked while the slides are still loading gets a message', async () => {
  workshopStore.setState({ loadSlideDecks: () => new Promise<SlideDeck[] | null>(() => {}) })
  render(<SlidesView />)
  const input = screen.getByLabelText('Choose PDF file')
  fireEvent.change(input, { target: { files: [pdfFile()] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Slides are still loading.')
  expect(pipeline.importPdf).not.toHaveBeenCalled()
})
