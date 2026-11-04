// pdf.js adapter for the import pipeline. Loaded on demand, so pdf.js only downloads when a PDF
// is imported.

import { AnnotationMode, getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfDocumentHandle, PdfOpener, PdfPageHandle } from './importPdf'

GlobalWorkerOptions.workerSrc = workerUrl

// Font, character map and decoder files that pdf.js fetches for some PDFs. Vite copies them into
// the build with hashed names, so we look them up by file name instead of by folder.
const binaryFiles: Record<string, string> = {
  ...import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*', {
    query: '?url',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('/node_modules/pdfjs-dist/cmaps/*', {
    query: '?url',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('/node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms}*.{wasm,js}', {
    query: '?url',
    import: 'default',
    eager: true,
  }),
}

const PREFIX = '/node_modules/pdfjs-dist/'

/** Largest embedded image pdf.js decodes, in pixels. */
const MAX_IMAGE_PIXELS = 100_000_000

/** Gives pdf.js its helper files from the bundled copies. */
class BundledBinaryDataFactory {
  private readonly bases: Record<string, string>
  constructor(options: { cMapUrl?: string; standardFontDataUrl?: string; wasmUrl?: string }) {
    this.bases = {
      cMapUrl: options.cMapUrl ?? '',
      standardFontDataUrl: options.standardFontDataUrl ?? '',
      wasmUrl: options.wasmUrl ?? '',
    }
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = this.bases[kind]
    const url = base === undefined ? undefined : binaryFiles[`${PREFIX}${base}${filename}`]
    if (!url) throw new Error(`Missing pdf.js file: ${kind} ${filename}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not load ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** WebP where the browser can make it, JPEG otherwise. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', 0.85)
  if (webp && webp.type === 'image/webp' && webp.size > 0) return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.88)
  if (!jpeg) throw new Error('The browser could not encode the page image')
  return jpeg
}

export const openPdf: PdfOpener = async (data, signal) => {
  const task = getDocument({
    data,
    enableXfa: false,
    useWorkerFetch: false,
    cMapUrl: 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'standard_fonts/',
    wasmUrl: 'wasm/',
    BinaryDataFactory: BundledBinaryDataFactory,
    // Keep pdf.js from fetching anything else.
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    // Skip images over 100 megapixels. A tiny PDF can hold a huge image that takes ages and
    // lots of memory to decode, and no slide needs one that big.
    maxImageSize: MAX_IMAGE_PIXELS,
  })
  const onAbort = () => void task.destroy()
  signal.addEventListener('abort', onAbort, { once: true })
  let pdf
  try {
    pdf = await task.promise
  } catch (err) {
    signal.removeEventListener('abort', onAbort)
    void task.destroy()
    throw err
  }

  const doc: PdfDocumentHandle = {
    numPages: pdf.numPages,
    async getPage(pageNumber) {
      const page = await pdf.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const handle: PdfPageHandle = {
        width: base.width,
        height: base.height,
        async render(width, height, renderSignal) {
          const viewport = page.getViewport({ scale: width / base.width })
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          try {
            const renderTask = page.render({
              canvas,
              viewport,
              annotationMode: AnnotationMode.ENABLE,
              background: '#ffffff',
            })
            const cancel = () => renderTask.cancel()
            renderSignal.addEventListener('abort', cancel, { once: true })
            try {
              await renderTask.promise
            } finally {
              renderSignal.removeEventListener('abort', cancel)
            }
            return await encode(canvas)
          } finally {
            // Free the pixel memory right away instead of waiting for garbage collection.
            canvas.width = 0
            canvas.height = 0
          }
        },
        close() {
          page.cleanup()
        },
      }
      return handle
    },
    async destroy() {
      signal.removeEventListener('abort', onAbort)
      await task.destroy()
    },
  }
  return doc
}
