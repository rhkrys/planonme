import { test, expect, type ConsoleMessage, type Page } from '@playwright/test'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

/** Collects console errors and uncaught exceptions of a page. */
function watchErrors(page: Page, into: string[], label: string) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') into.push(`${label} console: ${m.text()}`)
  })
  page.on('pageerror', (err) => into.push(`${label} exception: ${err.message}`))
}

test('load the sample workshop and run all its cues with the space bar', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  watchErrors(page, errors, 'control')

  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()

  // The first workshop is empty, so the plan offers the sample.
  await expect(page.getByText('No blocks yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Load sample workshop' }).click()
  await expect(page.getByRole('status')).toContainText('Added "Sample workshop".')
  await expect(picker.locator('option:checked')).toHaveText('Sample workshop')
  await expect(page.getByTestId('block-row')).toHaveCount(4)

  // Its slides and sounds are there too.
  await nav(page, 'Slides').click()
  await expect(page.getByRole('list', { name: 'Slides in Sample slides' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Slide 5', exact: true })).toBeVisible()
  await nav(page, 'Sounds').click()
  await expect(page.getByTestId('pad')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Play Break music' })).toBeVisible()

  const popupPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open audience window' }).click()
  const popup = await popupPromise
  watchErrors(popup, errors, 'audience')
  await popup.waitForURL(/\/audience\.html$/)

  await nav(page, 'Run').click()
  await expect(page.getByTestId('run-connection')).toHaveText('Audience window connected')
  const prompter = page.getByRole('region', { name: 'Teleprompter' })
  const cues = prompter.getByTestId('run-cue')
  await expect(cues).toHaveCount(11)
  await expect(prompter.getByTestId('run-cue-bad')).toHaveCount(0)

  // What each press of Space should show. Null means a sound or timer cue: the slide stays.
  const slideAfter: (number | null)[] = [1, null, 2, 3, null, null, 4, null, null, 5, null]
  let slide = 0
  for (const [i, expected] of slideAfter.entries()) {
    await page.keyboard.press('Space')
    await expect(cues.nth(i)).toHaveAttribute('aria-current', 'step')
    if (expected !== null) slide = expected
    await expect(popup.getByRole('img', { name: `Slide ${slide}` })).toBeVisible()
    if (i === 4) await expect(page.getByTestId('run-timer')).toBeVisible()
  }
  await expect(page.getByRole('region', { name: 'Wrap-up' })).toContainText('Now')

  // One more press reaches the end. No cue was skipped and no sound failed.
  await page.keyboard.press('Space')
  await expect(page.getByTestId('run-note')).toHaveText(/End of the script/)
  await expect(page.getByTestId('run-note')).not.toContainText('Skipped')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await popup.close()
  expect(errors).toEqual([])
})

test('the shortcut list opens with ? and lists the Run mode keys', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await nav(page, 'Run').focus()
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('GO: fire the next cue')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(nav(page, 'Run')).toBeFocused()

  // Number keys switch views.
  await page.keyboard.press('3')
  await expect(page.getByRole('heading', { name: 'Slides', level: 1 })).toBeVisible()
})

test('the app can be installed and works offline', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  )
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toBe('PlanOnMe')
  expect(manifest.display).toBe('standalone')
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(`/${icon.src}`)).ok()).toBe(true)
  }

  // Wait for the service worker to finish caching the app shell.
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible()
  await context.setOffline(false)
})
