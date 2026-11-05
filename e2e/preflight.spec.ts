import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { makeWav } from '../src/test/media'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(data: Uint8Array | string): never }

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([960, 540])
  return doc.save()
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function check(page: Page, id: string) {
  return page.getByTestId(`check-${id}`)
}

test('pre-flight checks the app live and remembers Zoom ticks for the session', async ({
  page,
  context,
}) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Pre-flight test')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Pre-flight test')

  await page.getByRole('textbox', { name: 'New block title' }).fill('Welcome')
  await page.getByRole('textbox', { name: 'New block minutes' }).fill('5')
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.locator('.block-title', { hasText: 'Welcome' })).toBeVisible()

  // Nothing is set up yet.
  await nav(page, 'Pre-flight').click()
  await expect(page.getByRole('heading', { name: 'Pre-flight', level: 1 })).toBeVisible()
  await expect(check(page, 'audience')).toHaveAttribute('data-status', 'fail')
  await expect(check(page, 'slides')).toHaveAttribute('data-status', 'warn')
  await expect(check(page, 'sounds')).toContainText('This workshop has no sounds.')
  await expect(page.getByTestId('preflight-progress')).toHaveText('2 of 8 done.')

  // Add slides, a sound and a script with one bad cue.
  await nav(page, 'Slides').click()
  await expect(page.getByLabel('Choose PDF file')).toBeEnabled()
  await page.getByLabel('Choose PDF file').setInputFiles({
    name: 'Deck.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await makePdf(2)),
  })
  await expect(page.getByRole('status')).toContainText('Added "Deck" with 2 slides.')

  await nav(page, 'Sounds').click()
  await expect(page.getByLabel('Choose audio files')).toBeEnabled()
  await page.getByLabel('Choose audio files').setInputFiles({
    name: 'Applause.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(makeWav(0.5, 8000, 660)),
  })
  await expect(page.getByTestId('pad')).toHaveCount(1)

  await nav(page, 'Script').click()
  await page.getByRole('button', { name: /^Welcome/ }).click()
  const box = page.getByRole('textbox', { name: 'Script for Welcome' })
  await box.fill('Hi [SLIDE 1] [SFX applause]\nLast one [SLIDE 5]')
  await box.blur()
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')

  await nav(page, 'Pre-flight').click()
  await expect(check(page, 'slides')).toContainText('2 slides in 1 deck.')
  await expect(check(page, 'sounds')).toHaveAttribute('data-status', 'ok')
  await expect(check(page, 'sounds')).toContainText('All 1 sound plays.')
  await expect(check(page, 'cues')).toHaveAttribute('data-status', 'fail')
  await expect(page.getByRole('list', { name: 'Cue problems' })).toContainText(
    'Welcome, line 2: [SLIDE 5]. There is no slide 5.',
  )

  // Fix the cue.
  await nav(page, 'Script').click()
  await box.fill('Hi [SLIDE 1] [SFX applause]\nLast one [SLIDE 2]')
  await box.blur()
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')
  await nav(page, 'Pre-flight').click()
  await expect(check(page, 'cues')).toContainText('All 3 cues are valid.')

  // The audience window, opened from the checklist.
  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open the audience window' }).click()
  const popup = await popupPromise
  await popup.waitForURL(/\/audience\.html$/)
  await expect(check(page, 'audience')).toHaveAttribute('data-status', 'ok')
  await expect(page.getByRole('button', { name: 'Open the audience window' })).toHaveCount(0)
  await expect(page.getByTestId('preflight-progress')).toHaveText('4 of 8 done.')

  // The test tone plays through the engine.
  await page.getByRole('button', { name: 'Play test tone' }).click()
  await expect(page.getByTestId('tone-state')).toHaveText('Playing...')
  await expect(page.getByTestId('tone-state')).toHaveText('')
  await expect(page.getByRole('alert')).toHaveCount(0)

  for (const name of [
    'I heard the test tone',
    'Click Share screen in Zoom',
    'Pick the "PlanOnMe Audience" window',
    'Tick "Share sound"',
  ]) {
    await page.getByRole('checkbox', { name }).check()
  }
  await expect(page.getByTestId('preflight-progress')).toHaveText(
    'All set. You are ready to go live.',
  )

  // Ticks survive a reload of the tab.
  await page.reload()
  await expect(picker).toBeEnabled()
  await nav(page, 'Pre-flight').click()
  await expect(page.getByRole('checkbox', { name: 'Tick "Share sound"' })).toBeChecked()
  await expect(
    page.getByRole('checkbox', { name: 'Tick "Optimize for video clip" (optional)' }),
  ).not.toBeChecked()
  await expect(check(page, 'audience')).toHaveAttribute('data-status', 'ok')

  // Another workshop has its own ticks.
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Second')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Second')
  await expect(page.getByRole('checkbox', { name: 'Tick "Share sound"' })).not.toBeChecked()
  await picker.selectOption({ label: 'Pre-flight test' })
  await expect(page.getByRole('checkbox', { name: 'Tick "Share sound"' })).toBeChecked()

  // Run mode links here.
  await nav(page, 'Run').click()
  await page.getByRole('button', { name: 'Open pre-flight checklist' }).click()
  await expect(page.getByRole('heading', { name: 'Pre-flight', level: 1 })).toBeVisible()
})
