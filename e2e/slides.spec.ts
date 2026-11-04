import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(data: Uint8Array | string): never }

/** A small PDF with numbered 16:9 pages, made in code. */
async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([960, 540])
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.1, 0.2, 0.5) })
    page.drawText(`${label} ${i}`, { x: 80, y: 250, size: 64, font, color: rgb(1, 1, 1) })
  }
  return doc.save()
}

async function importPdf(page: Page, name: string, bytes: Uint8Array | string) {
  await page.getByLabel('Choose PDF file').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  })
}

test('import PDFs into decks, see thumbnails, rename, reorder and delete', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slides' }).click()
  await expect(page.getByText('No slides yet.')).toBeVisible()

  await page.getByRole('combobox', { name: 'Made with' }).selectOption('canva')
  await importPdf(page, 'Intro deck.pdf', await makePdf(3, 'Intro'))
  await expect(page.getByRole('status')).toContainText('Added "Intro deck" with 3 slides.')

  const decks = page.getByTestId('deck')
  await expect(decks).toHaveCount(1)
  await expect(decks.first()).toContainText('Slides 1 to 3')
  await expect(decks.first()).toContainText('Canva')
  const intro = page.getByRole('list', { name: 'Slides in Intro deck' })
  await expect(intro.getByRole('img')).toHaveCount(3)
  for (const n of [1, 2, 3]) {
    const img = intro.getByRole('img', { name: `Slide ${n}`, exact: true })
    await expect(img).toBeVisible()
    // The image really decoded and is about 1920 pixels wide.
    await expect
      .poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth))
      .toBe(1920)
  }

  await page.getByRole('textbox', { name: 'Deck name' }).fill('Wrap up')
  await importPdf(page, 'second.pdf', await makePdf(2, 'Wrap'))
  await expect(decks).toHaveCount(2)
  const wrap = page.getByRole('list', { name: 'Slides in Wrap up' })
  await expect(wrap.getByRole('img', { name: 'Slide 4', exact: true })).toBeVisible()
  await expect(wrap.getByRole('img', { name: 'Slide 5', exact: true })).toBeVisible()

  // Move the second deck up: its slides become 1 and 2.
  await page.getByRole('button', { name: 'Move Wrap up up' }).click()
  await expect(decks.first()).toContainText('Slides 1 to 2')
  await expect(wrap.getByRole('img', { name: 'Slide 1', exact: true })).toBeVisible()
  await expect(intro.getByRole('img', { name: 'Slide 3', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Rename Intro deck' }).click()
  await page
    .getByRole('form', { name: 'Rename deck Intro deck' })
    .getByRole('textbox', { name: 'Deck name' })
    .fill('Opening')
  await page.getByRole('button', { name: 'Save deck name' }).click()
  await expect(page.getByRole('heading', { name: 'Opening' })).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Slides' }).click()
  await expect(decks).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Slides in Opening' }).getByRole('img')).toHaveCount(
    3,
  )

  await page.getByRole('button', { name: 'Delete Wrap up' }).click()
  await page
    .getByRole('group', { name: 'Confirm delete deck Wrap up' })
    .getByRole('button', { name: 'Delete deck' })
    .click()
  await expect(decks).toHaveCount(1)
  await expect(decks.first()).toContainText('Slides 1 to 3')
})

test('a broken or wrong file shows an error and the app keeps working', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slides' }).click()

  await importPdf(page, 'notes.pdf', 'just some text, not a PDF')
  await expect(page.getByRole('alert')).toContainText('This file is not a PDF.')
  await page.getByRole('button', { name: 'Dismiss' }).click()

  await importPdf(page, 'broken.pdf', '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nthis is not right')
  await expect(page.getByRole('alert')).toContainText(/damaged|no pages/)
  await expect(page.getByTestId('deck')).toHaveCount(0)

  // A good file still imports after the errors.
  await importPdf(page, 'ok.pdf', await makePdf(1, 'Fine'))
  await expect(page.getByTestId('deck')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the help panel explains how to export a PDF', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Slides' }).click()
  await page.getByText('How to save your slides as a PDF').click()
  for (const tool of ['PowerPoint', 'Google Slides', 'Canva', 'Gamma']) {
    await expect(page.getByRole('heading', { name: tool, exact: true })).toBeVisible()
  }
})

test('drop a PDF on the drop zone to import it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slides' }).click()
  await expect(page.getByLabel('Choose PDF file')).toBeEnabled()
  const bytes = Array.from(await makePdf(2, 'Dropped'))
  const dataTransfer = await page.evaluateHandle((data) => {
    // Runs in the browser, where these DOM classes exist.
    const g = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: unknown): void } }
      File: new (parts: unknown[], name: string, options: { type: string }) => unknown
    }
    const dt = new g.DataTransfer()
    dt.items.add(
      new g.File([new Uint8Array(data)], 'Dropped deck.pdf', { type: 'application/pdf' }),
    )
    return dt
  }, bytes)
  const zone = page.getByTestId('drop-zone')
  await zone.dispatchEvent('dragover', { dataTransfer })
  await zone.dispatchEvent('drop', { dataTransfer })
  await expect(
    page.getByRole('list', { name: 'Slides in Dropped deck' }).getByRole('img'),
  ).toHaveCount(2)
})
