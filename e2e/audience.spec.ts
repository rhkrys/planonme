import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(data: Uint8Array | string): never }

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

async function importPdf(page: Page, name: string, bytes: Uint8Array) {
  await expect(page.getByLabel('Choose PDF file')).toBeEnabled()
  await page.getByLabel('Choose PDF file').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  })
}

/** The source of the image the audience window shows, once it has really decoded. */
async function shownSlide(popup: Page) {
  const img = popup.getByTestId('audience-slide')
  await expect
    .poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth))
    .toBe(1920)
  return img
}

test('the audience window follows the control window and resyncs after reloads', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slides' }).click()
  await importPdf(page, 'Talk.pdf', await makePdf(3, 'Talk'))
  await expect(page.getByRole('status')).toContainText('Added "Talk" with 3 slides.')
  await expect(page.getByTestId('audience-now')).toHaveText('Showing slide 1 of 3.')
  await expect(page.getByTestId('audience-connection')).toHaveText('Not connected')

  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open audience window' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  expect(popup.url()).toMatch(/\/audience\.html$/)

  await expect(page.getByTestId('audience-connection')).toHaveText('Connected')
  await expect(await shownSlide(popup)).toHaveAttribute('alt', 'Slide 1')

  // Arrow keys in the Slides view change the slide.
  await page.locator('body').press('ArrowRight')
  await expect(page.getByTestId('audience-now')).toHaveText('Showing slide 2 of 3.')
  await expect(popup.getByRole('img', { name: 'Slide 2' })).toBeVisible()
  await shownSlide(popup)
  await expect(page.getByRole('img', { name: 'Audience preview: slide 2' })).toBeVisible()

  // Clicking a thumbnail shows that slide.
  await page.getByRole('button', { name: 'Show slide 3' }).click()
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()
  await page.locator('body').press('ArrowRight')
  await expect(page.getByTestId('audience-now')).toHaveText('Showing slide 3 of 3.')
  await page.getByRole('button', { name: 'Previous slide' }).click()
  await expect(popup.getByRole('img', { name: 'Slide 2' })).toBeVisible()

  // Blank and logo screens.
  await page.locator('body').press('b')
  await expect(popup.getByTestId('audience-blank')).toBeAttached()
  await expect(popup.getByTestId('audience-slide')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Blank (B)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Logo (L)' }).click()
  await expect(popup.getByTestId('audience-logo')).toHaveText('My workshop')
  await page.locator('body').press('l')
  await expect(popup.getByRole('img', { name: 'Slide 2' })).toBeVisible()

  // A reloaded audience window asks for the screen again.
  await popup.reload()
  await expect(await shownSlide(popup)).toHaveAttribute('alt', 'Slide 2')

  // A reloaded control window keeps the slide and does not move the audience.
  await page.reload()
  await page.getByRole('button', { name: 'Slides' }).click()
  await expect(page.getByTestId('audience-now')).toHaveText('Showing slide 2 of 3.')
  await expect(page.getByTestId('audience-connection')).toHaveText('Connected')
  await page.locator('body').press('ArrowRight')
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()

  // Typing in a text field does not change the slide.
  await page.getByRole('textbox', { name: 'Deck name' }).press('ArrowLeft')
  await expect(page.getByTestId('audience-now')).toHaveText('Showing slide 3 of 3.')

  // The button brings the open window to the front instead of opening another one.
  await page.getByRole('button', { name: 'Open audience window' }).click()
  expect(context.pages()).toHaveLength(2)

  // A new control tab (nothing remembered yet) takes over what the audience already shows.
  const second = await context.newPage()
  await second.goto('/')
  await second.getByRole('button', { name: 'Slides' }).click()
  await expect(second.getByTestId('audience-now')).toHaveText('Showing slide 3 of 3.')
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()
  await second.close()

  await popup.close()
  await expect(page.getByTestId('audience-connection')).toHaveText('Not connected')
})

test('the audience window waits for PlanOnMe and hides the cursor', async ({ page }) => {
  await page.goto('/audience.html')
  await expect(page.getByText('Waiting for PlanOnMe')).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(0)
  await page.mouse.move(10, 10)
  await expect(page.getByTestId('audience')).not.toHaveClass(/idle/)
  await expect(page.getByTestId('audience')).toHaveClass(/idle/, { timeout: 5000 })
})

test('a blocked popup shows how to allow it', async ({ page }) => {
  await page.addInitScript('window.open = () => null')
  await page.goto('/')
  await page.getByRole('button', { name: 'Open audience window' }).click()
  await expect(page.getByRole('alert')).toContainText('The browser blocked the audience window.')
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
