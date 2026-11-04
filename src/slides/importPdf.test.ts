// @vitest-environment node
import { fakePngBytes } from '../test/media'
import {
  deckNameFromFile,
  hasPdfSignature,
  importPdf,
  MAX_PDF_PAGES,
  renderSize,
  SlideImportCancelled,
  SlideImportError,
  type ImportProgress,
  type PdfDocumentHandle,
  type PdfOpener,
} from './importPdf'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const PDF = new Blob(['%PDF-1.7\nrest of a pdf'], { type: 'application/pdf' })

function pngBlob(): Blob {
  return new Blob([fakePngBytes()], { type: 'image/png' })
}

interface FakeOptions {
  pages?: number
  width?: number
  height?: number
  render?: (n: number, signal: AbortSignal) => Promise<Blob>
}

/** A stand in for pdf.js that records what the pipeline asked for. */
function fakePdf(options: FakeOptions = {}) {
  const calls = { sizes: [] as [number, number][], closed: 0, destroyed: 0 }
  const open: PdfOpener = async () => {
    const doc: PdfDocumentHandle = {
      numPages: options.pages ?? 3,
      async getPage(n) {
        return {
          width: options.width ?? 960,
          height: options.height ?? 540,
          async render(w, h, signal) {
            calls.sizes.push([w, h])
            return options.render ? options.render(n, signal) : pngBlob()
          },
          close() {
            calls.closed++
          },
        }
      },
      async destroy() {
        calls.destroyed++
      },
    }
    return doc
  }
  return { open, calls }
}

function failingOpener(name: string): PdfOpener {
  return async () => {
    const err = new Error('pdf.js said no')
    err.name = name
    throw err
  }
}

async function importError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (err) {
    return err as Error
  }
  throw new Error('expected the import to fail')
}

test('renders every page at slide size and reports progress', async () => {
  const { open, calls } = fakePdf({ pages: 3 })
  const progress: ImportProgress[] = []
  const result = await importPdf(PDF, { open, onProgress: (p) => progress.push(p) })
  expect(result.slides).toHaveLength(3)
  expect(result.slides.every((s) => s.type === 'image/png')).toBe(true)
  expect(calls.sizes).toEqual([
    [1920, 1080],
    [1920, 1080],
    [1920, 1080],
  ])
  expect(progress).toEqual([
    { done: 0, total: 0 },
    { done: 0, total: 3 },
    { done: 1, total: 3 },
    { done: 2, total: 3 },
    { done: 3, total: 3 },
  ])
  expect(calls.closed).toBe(3)
  expect(calls.destroyed).toBe(1)
})

test('checks the file before opening it', async () => {
  const { open } = fakePdf()
  expect((await importError(importPdf(new Blob([]), { open }))).message).toBe('This file is empty.')
  expect((await importError(importPdf(new Blob(['hello there']), { open }))).message).toBe(
    'This file is not a PDF.',
  )
  const tooBig = await importError(importPdf(PDF, { open, maxBytes: 10 }))
  expect(tooBig).toBeInstanceOf(SlideImportError)
  expect(tooBig.message).toMatch(/too big/)
})

test('finds the PDF signature after a few junk bytes, but not far into the file', () => {
  const enc = new TextEncoder()
  expect(hasPdfSignature(enc.encode('%PDF-1.4'))).toBe(true)
  expect(hasPdfSignature(enc.encode('\n\n  %PDF-1.4'))).toBe(true)
  expect(hasPdfSignature(enc.encode(`${' '.repeat(2000)}%PDF-1.4`))).toBe(false)
  expect(hasPdfSignature(enc.encode('%PDF'))).toBe(false)
  expect(hasPdfSignature(new Uint8Array())).toBe(false)
})

test('locked and damaged PDFs give clear errors', async () => {
  const locked = await importError(importPdf(PDF, { open: failingOpener('PasswordException') }))
  expect(locked).toBeInstanceOf(SlideImportError)
  expect(locked.message).toMatch(/password/)

  const damaged = await importError(importPdf(PDF, { open: failingOpener('InvalidPDFException') }))
  expect(damaged.message).toMatch(/damaged/)

  const other = await importError(importPdf(PDF, { open: failingOpener('TypeError') }))
  expect(other).toBeInstanceOf(SlideImportError)
  expect(other.message).toMatch(/Could not open this PDF/)
})

test('limits the page count', async () => {
  const none = await importError(importPdf(PDF, { open: fakePdf({ pages: 0 }).open }))
  expect(none.message).toBe('This PDF has no pages.')

  const tooMany = fakePdf({ pages: MAX_PDF_PAGES + 1 })
  const err = await importError(importPdf(PDF, { open: tooMany.open }))
  expect(err.message).toBe(
    `This PDF has ${MAX_PDF_PAGES + 1} pages. The limit is ${MAX_PDF_PAGES}.`,
  )
  expect(tooMany.calls.sizes).toHaveLength(0)
  expect(tooMany.calls.destroyed).toBe(1)

  const noRoom = await importError(
    importPdf(PDF, { open: fakePdf({ pages: 5 }).open, maxPages: 4 }),
  )
  expect(noRoom.message).toMatch(/only room for 4 more slides/)

  const full = await importError(importPdf(PDF, { open: fakePdf().open, maxPages: 0 }))
  expect(full.message).toMatch(/as many slides as it can hold/)
})

test('a page that fails to draw names the page', async () => {
  const { open, calls } = fakePdf({
    render: async (n) => {
      if (n === 2) throw new Error('bad operator')
      return pngBlob()
    },
  })
  const err = await importError(importPdf(PDF, { open }))
  expect(err.message).toBe('Page 2 of this PDF could not be drawn. It may be damaged.')
  expect(calls.destroyed).toBe(1)
})

test('rejects page images that are empty, too big or not a stored image type', async () => {
  const empty = fakePdf({ render: async () => new Blob([], { type: 'image/png' }) })
  expect((await importError(importPdf(PDF, { open: empty.open }))).message).toMatch(/empty/)

  const wrongType = fakePdf({ render: async () => new Blob(['GIF89a'], { type: 'image/gif' }) })
  expect((await importError(importPdf(PDF, { open: wrongType.open }))).message).toMatch(
    /not in a format/,
  )

  const lying = fakePdf({ render: async () => new Blob([fakePngBytes()], { type: 'image/jpeg' }) })
  expect((await importError(importPdf(PDF, { open: lying.open }))).message).toMatch(
    /not in a format/,
  )

  const huge = fakePdf({
    render: async () => new Blob([fakePngBytes(21 * 1024 * 1024)], { type: 'image/png' }),
  })
  expect((await importError(importPdf(PDF, { open: huge.open }))).message).toMatch(/too big/)
})

test('cancel stops between pages and cleans up', async () => {
  const controller = new AbortController()
  const { open, calls } = fakePdf({
    pages: 5,
    render: async (n) => {
      if (n === 2) controller.abort()
      return pngBlob()
    },
  })
  const err = await importError(importPdf(PDF, { open, signal: controller.signal }))
  expect(err).toBeInstanceOf(SlideImportCancelled)
  expect(calls.sizes).toHaveLength(2)
  expect(calls.destroyed).toBe(1)
})

test('cancel passes the abort on to a page that is drawing', async () => {
  const controller = new AbortController()
  let seen: AbortSignal | null = null
  const { open, calls } = fakePdf({
    render: (_n, signal) => {
      seen = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Rendering cancelled')))
        controller.abort()
      })
    },
  })
  const err = await importError(importPdf(PDF, { open, signal: controller.signal }))
  expect(err).toBeInstanceOf(SlideImportCancelled)
  expect(seen).not.toBeNull()
  expect(calls.destroyed).toBe(1)
})

test('an already cancelled import does not open the PDF', async () => {
  const controller = new AbortController()
  controller.abort()
  const open = vi.fn<PdfOpener>()
  const err = await importError(importPdf(PDF, { open, signal: controller.signal }))
  expect(err).toBeInstanceOf(SlideImportCancelled)
  expect(open).not.toHaveBeenCalled()
})

test('renderSize keeps the aspect ratio and caps tall pages', () => {
  expect(renderSize(960, 540)).toEqual({ width: 1920, height: 1080 })
  expect(renderSize(612, 792)).toEqual({ width: 1669, height: 2160 })
  expect(renderSize(100, 10_000)).toEqual({ width: 22, height: 2160 })
  expect(renderSize(10_000, 1)).toEqual({ width: 1920, height: 1 })
  expect(() => renderSize(0, 100)).toThrow(SlideImportError)
  expect(() => renderSize(Number.NaN, 100)).toThrow(SlideImportError)
  expect(() => renderSize(100, Number.POSITIVE_INFINITY)).toThrow(SlideImportError)
})

test('a page with no size gives a page error', async () => {
  const { open } = fakePdf({ width: 0 })
  const err = await importError(importPdf(PDF, { open }))
  expect(err.message).toBe('Page 1: This page has no size.')
})

test('deck names come from the file name', () => {
  expect(deckNameFromFile('Kickoff.pdf')).toBe('Kickoff')
  expect(deckNameFromFile('notes.PDF')).toBe('notes')
  expect(deckNameFromFile('.pdf')).toBe('Slides')
  expect(deckNameFromFile('x'.repeat(300))).toHaveLength(200)
})
