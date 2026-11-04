// Turns a PDF file into one image per page. The PDF is untrusted: every step checks its input
// and turns failures into a SlideImportError with a message the user can read.

import { sniffImageType } from '../db/backup'
import { LIMITS } from '../db/limits'

const MB = 1024 * 1024

/** Largest PDF we try to open. */
export const MAX_PDF_BYTES = 200 * MB
/** Most pages we import from one PDF. */
export const MAX_PDF_PAGES = 300
/** Width of a rendered slide image in pixels. */
export const SLIDE_WIDTH = 1920
/** Tallest rendered slide image in pixels, so a very tall page does not use huge amounts of memory. */
export const MAX_SLIDE_HEIGHT = 2160

/** A problem the user should read, such as a damaged or locked PDF. */
export class SlideImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlideImportError'
  }
}

/** The user cancelled the import. */
export class SlideImportCancelled extends Error {
  constructor() {
    super('Import cancelled.')
    this.name = 'SlideImportCancelled'
  }
}

/** One page of an open PDF, as the pipeline needs it. */
export interface PdfPageHandle {
  /** Page size at scale 1, in PDF points. */
  width: number
  height: number
  /** Draws the page at the given pixel size and encodes it as an image. */
  render(width: number, height: number, signal: AbortSignal): Promise<Blob>
  close(): void
}

/** An open PDF, as the pipeline needs it. */
export interface PdfDocumentHandle {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageHandle>
  destroy(): Promise<void>
}

/**
 * Opens PDF bytes. Throws an error named PasswordException for a locked PDF and
 * InvalidPDFException for a damaged one, the way pdf.js does.
 */
export type PdfOpener = (
  data: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) => Promise<PdfDocumentHandle>

export interface ImportProgress {
  /** Pages finished so far. */
  done: number
  /** Pages to render, or 0 while the PDF is still opening. */
  total: number
}

export interface ImportPdfOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImportProgress) => void
  /** How many pages may be imported, for example what is left of the slide limit. */
  maxPages?: number
  maxBytes?: number
  /** Opens the PDF. Defaults to pdf.js, loaded on first use. */
  open?: PdfOpener
}

export interface ImportedPdf {
  slides: Blob[]
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

/** True when the PDF signature appears in the first bytes, where the PDF format allows it. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - PDF_SIGNATURE.length
  for (let i = 0; i <= end; i++) {
    if (PDF_SIGNATURE.every((v, j) => bytes[i + j] === v)) return true
  }
  return false
}

/** The deck name to suggest for a file, taken from its file name. */
export function deckNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim()
  return (base || 'Slides').slice(0, LIMITS.maxTitleLength)
}

/** Pixel size for a page, about SLIDE_WIDTH wide and never taller than MAX_SLIDE_HEIGHT. */
export function renderSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new SlideImportError('This page has no size.')
  }
  const scale = Math.min(SLIDE_WIDTH / width, MAX_SLIDE_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function checkCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new SlideImportCancelled()
}

function openError(err: unknown): Error {
  if (err instanceof SlideImportCancelled || err instanceof SlideImportError) return err
  const name = err instanceof Error ? err.name : ''
  if (name === 'PasswordException') {
    return new SlideImportError(
      'This PDF is protected with a password. Save a copy without a password and try again.',
    )
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new SlideImportError('This PDF is damaged or not a real PDF. Export it again and retry.')
  }
  if (name === 'AbortException') return new SlideImportCancelled()
  return new SlideImportError(
    'Could not open this PDF. It may be damaged. Export it again and retry.',
  )
}

async function loadDefaultOpener(): Promise<PdfOpener> {
  try {
    const mod = await import('./pdfjs')
    return mod.openPdf
  } catch (err) {
    console.error(err)
    throw new SlideImportError('Could not load the PDF reader. Check your connection and reload.')
  }
}

/**
 * Renders every page of a PDF to an image. Reports progress, stops when the signal aborts
 * (throwing SlideImportCancelled) and throws SlideImportError for any problem with the file.
 */
export async function importPdf(file: Blob, options: ImportPdfOptions = {}): Promise<ImportedPdf> {
  const { signal, onProgress } = options
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES
  const maxPages = Math.min(options.maxPages ?? MAX_PDF_PAGES, MAX_PDF_PAGES)

  if (file.size === 0) throw new SlideImportError('This file is empty.')
  if (file.size > maxBytes) {
    throw new SlideImportError(
      `This PDF is too big (${Math.ceil(file.size / MB)} MB). The limit is ${Math.floor(maxBytes / MB)} MB.`,
    )
  }
  if (maxPages < 1) {
    throw new SlideImportError(
      'This workshop has as many slides as it can hold. Delete a deck first.',
    )
  }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch (err) {
    console.error(err)
    throw new SlideImportError('Could not read the file.')
  }
  checkCancelled(signal)
  if (!hasPdfSignature(bytes)) throw new SlideImportError('This file is not a PDF.')

  onProgress?.({ done: 0, total: 0 })
  const open = options.open ?? (await loadDefaultOpener())
  checkCancelled(signal)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let doc: PdfDocumentHandle | null = null
  try {
    try {
      doc = await open(bytes, controller.signal)
    } catch (err) {
      checkCancelled(signal)
      if (!(err instanceof SlideImportError)) console.error(err)
      throw openError(err)
    }
    checkCancelled(signal)

    const total = doc.numPages
    if (!Number.isInteger(total) || total < 1) {
      throw new SlideImportError('This PDF has no pages.')
    }
    if (total > maxPages) {
      throw new SlideImportError(
        maxPages < MAX_PDF_PAGES
          ? `This PDF has ${total} pages, but there is only room for ${maxPages} more slides in this workshop.`
          : `This PDF has ${total} pages. The limit is ${MAX_PDF_PAGES}.`,
      )
    }
    onProgress?.({ done: 0, total })

    const slides: Blob[] = []
    for (let n = 1; n <= total; n++) {
      checkCancelled(signal)
      slides.push(await renderPage(doc, n, controller.signal, signal))
      onProgress?.({ done: n, total })
    }
    checkCancelled(signal)
    return { slides }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (doc) {
      try {
        await doc.destroy()
      } catch (err) {
        console.error(err)
      }
    }
  }
}

async function renderPage(
  doc: PdfDocumentHandle,
  n: number,
  renderSignal: AbortSignal,
  userSignal: AbortSignal | undefined,
): Promise<Blob> {
  let page: PdfPageHandle | null = null
  try {
    page = await doc.getPage(n)
    const size = renderSize(page.width, page.height)
    const blob = await page.render(size.width, size.height, renderSignal)
    checkCancelled(userSignal)
    await checkImage(blob)
    return blob
  } catch (err) {
    checkCancelled(userSignal)
    if (err instanceof SlideImportError) {
      throw new SlideImportError(`Page ${n}: ${err.message}`)
    }
    console.error(err)
    throw new SlideImportError(`Page ${n} of this PDF could not be drawn. It may be damaged.`)
  } finally {
    try {
      page?.close()
    } catch (err) {
      console.error(err)
    }
  }
}

/** The stored slide must be a PNG, JPEG or WebP image within the size limit. */
async function checkImage(blob: Blob): Promise<void> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new SlideImportError('The page image came out empty.')
  }
  if (blob.size > LIMITS.maxSlideBytes) {
    throw new SlideImportError('The page image is too big to store.')
  }
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const type = sniffImageType(head)
  if (!type || type !== blob.type) {
    throw new SlideImportError('The page image is not in a format we can store.')
  }
}
