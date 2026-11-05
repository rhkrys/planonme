import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(data: Uint8Array | string): never }

async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([960, 540])
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.2, 0.4, 0.3) })
    page.drawText(`${label} ${i}`, { x: 80, y: 250, size: 64, font, color: rgb(1, 1, 1) })
  }
  return doc.save()
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

async function addBlock(page: Page, title: string, minutes: string) {
  await page.getByRole('textbox', { name: 'New block title' }).fill(title)
  await page.getByRole('textbox', { name: 'New block minutes' }).fill(minutes)
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.locator('.block-title', { hasText: title })).toBeVisible()
}

async function writeScript(page: Page, block: string, text: string) {
  await page.getByRole('button', { name: new RegExp(`^${block}`) }).click()
  const box = page.getByRole('textbox', { name: `Script for ${block}` })
  await box.fill(text)
  await box.blur()
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')
}

test('run a small workshop with the space bar and drive the audience window', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Run test')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Run test')
  await addBlock(page, 'Welcome', '5')
  await addBlock(page, 'Practice', '10')

  // Three slides.
  await nav(page, 'Slides').click()
  await expect(page.getByLabel('Choose PDF file')).toBeEnabled()
  await page.getByLabel('Choose PDF file').setInputFiles({
    name: 'Deck.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await makePdf(3, 'Deck')),
  })
  await expect(page.getByRole('status')).toContainText('Added "Deck" with 3 slides.')

  await nav(page, 'Script').click()
  await writeScript(page, 'Welcome', 'Hello everyone. [SLIDE 2]\nToday we practice. [SFX ghost]')
  await writeScript(page, 'Practice', 'Time to work. [SLIDE 3] [TIMER 3s]\nAll done. [SLIDE 1]')

  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open audience window' }).click()
  const popup = await popupPromise
  await popup.waitForURL(/\/audience\.html$/)

  await nav(page, 'Run').click()
  await expect(page.getByRole('heading', { name: 'Run', level: 1 })).toBeVisible()
  await expect(page.getByTestId('run-connection')).toHaveText('Audience window connected')
  const prompter = page.getByRole('region', { name: 'Teleprompter' })
  await expect(prompter.getByTestId('run-cue')).toHaveCount(4)
  await expect(prompter.getByTestId('run-cue-bad')).toContainText('[SFX ghost] (will be skipped')
  await expect(page.getByTestId('next-cue')).toContainText('[SLIDE 2]')
  await expect(page.getByRole('img', { name: 'Next slide: slide 2' })).toBeVisible()

  // Focus is still on the Run button in the sidebar. Space runs GO, it does not click it.
  await page.keyboard.press('Space')
  await expect(popup.getByRole('img', { name: 'Slide 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Jump to \[SLIDE 2\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible()

  // The unknown sound is skipped with a note. The next slide comes from the next block.
  await page.keyboard.press('Space')
  await expect(page.getByTestId('run-note')).toContainText('Skipped [SFX ghost].')
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Practice' })).toContainText('Now')

  // The timer counts down and runs out.
  await page.keyboard.press('Space')
  await expect(page.getByTestId('run-timer')).toBeVisible()
  await expect(page.getByTestId('run-timer')).toHaveText('Time is up', { timeout: 6000 })

  // Shift+Space steps back. The audience gets the slide of that cue again.
  await page.keyboard.press('Shift+Space')
  await page.keyboard.press('Shift+Space')
  await expect(popup.getByRole('img', { name: 'Slide 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Jump to \[SLIDE 2\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )

  // Arrow keys move the slides directly.
  await page.keyboard.press('ArrowRight')
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(popup.getByRole('img', { name: 'Slide 1' })).toBeVisible()

  // Clicking a cue jumps to it, then GO fires the cue after it.
  await page.getByRole('button', { name: /^Jump to \[TIMER 3s\]/ }).click()
  await expect(popup.getByRole('img', { name: 'Slide 3' })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(popup.getByRole('img', { name: 'Slide 1' })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('run-note')).toHaveText(/End of the script/)

  // Reset clears the session clock.
  await page.getByRole('button', { name: 'Reset session' }).click()
  await expect(page.getByTestId('elapsed')).toHaveText('0:00')
  await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible()

  await popup.close()
  await expect(page.getByTestId('run-connection')).toHaveText('Audience window not open')
})

test('a reload keeps the run, and Back into the last block keeps its time', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Reload test')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Reload test')
  await addBlock(page, 'Intro', '5')
  await addBlock(page, 'Talk', '20')
  await nav(page, 'Script').click()
  await writeScript(page, 'Intro', 'Hi. [TIMER 5m] [STOP MUSIC]')
  await writeScript(page, 'Talk', 'Go on. [TIMER 1m]')

  await nav(page, 'Run').click()
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('block-countdown')).toHaveText(/^4:5\d$/)
  // One GO too many goes into the next block. Back returns without restarting Intro.
  await page.keyboard.press('Space')
  await expect(page.getByRole('region', { name: 'Talk' })).toContainText('Now')
  await page.waitForTimeout(1100)
  await page.keyboard.press('Shift+Space')
  await expect(page.getByRole('region', { name: 'Intro' })).toContainText('Now')
  await expect(page.getByTestId('block-countdown')).not.toHaveText('5:00')

  await page.reload()
  await nav(page, 'Run').click()
  await expect(page.getByRole('button', { name: /^Jump to \[STOP MUSIC\]/ })).toHaveAttribute(
    'aria-current',
    'step',
  )
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible()
  await expect(page.getByTestId('elapsed')).not.toHaveText('0:00')
  await expect(page.getByTestId('run-timer')).toBeVisible()
})
