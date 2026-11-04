import { test, expect, type Page } from '@playwright/test'

async function addBlock(page: Page, title: string, minutes: string) {
  await page.getByRole('textbox', { name: 'New block title' }).fill(title)
  await page.getByRole('textbox', { name: 'New block minutes' }).fill(minutes)
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.locator('.block-title', { hasText: title })).toBeVisible()
}

function titles(page: Page) {
  return page.getByTestId('block-row').locator('.block-title')
}

test('plan a workshop, reorder blocks and keep it after reload', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()

  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Design sprint')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Design sprint')
  await expect(page.getByText('No blocks yet.')).toBeVisible()

  const length = page.getByRole('textbox', { name: 'Session length (minutes)' })
  await length.fill('45')
  await length.press('Enter')
  await page.getByLabel('Date').fill('2026-12-01')

  await addBlock(page, 'Welcome', '10')
  await addBlock(page, 'Sketching', '20')
  await addBlock(page, 'Wrap up', '10')
  await expect(page.getByText('Planned 40 min of 45 min')).toBeVisible()
  await expect(page.getByText('5 min left')).toBeVisible()

  // Keyboard friendly reorder.
  await page.getByRole('button', { name: 'Move Wrap up up' }).click()
  await expect(titles(page)).toHaveText(['Welcome', 'Wrap up', 'Sketching'])

  // Drag and drop reorder: drag Welcome onto the last block.
  const rows = page.getByTestId('block-row')
  await rows.nth(0).dragTo(rows.nth(2))
  await expect(titles(page)).toHaveText(['Wrap up', 'Sketching', 'Welcome'])
  await expect(rows.nth(2).locator('.block-start')).toHaveText('Starts at 0:30')

  // Make one block longer, which runs the plan over time.
  await page.getByRole('button', { name: 'Edit Sketching' }).click()
  await page.getByRole('textbox', { name: 'Block minutes', exact: true }).fill('35')
  await page.getByRole('button', { name: 'Save block' }).click()
  await expect(page.getByText('Planned 55 min of 45 min')).toBeVisible()
  await expect(page.getByText(/Over time by 10 min/)).toBeVisible()

  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')
  await page.reload()
  await expect(picker.locator('option:checked')).toHaveText('Design sprint')
  await expect(titles(page)).toHaveText(['Wrap up', 'Sketching', 'Welcome'])
  await expect(page.getByText('Planned 55 min of 45 min')).toBeVisible()
  await expect(page.getByText(/Over time by 10 min/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Session length (minutes)' })).toHaveValue('45')
  await expect(page.getByLabel('Date')).toHaveValue('2026-12-01')

  // Fix the over time by making the session longer, and see it stick.
  await length.fill('60')
  await length.press('Enter')
  await expect(page.getByText('5 min left')).toBeVisible()
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')
  await page.reload()
  await expect(page.getByText('Planned 55 min of 1 h')).toBeVisible()
  await expect(page.getByText('5 min left')).toBeVisible()
})

test('a bad duration shows an error and adds nothing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('textbox', { name: 'New block title' }).fill('Too long')
  await page.getByRole('textbox', { name: 'New block minutes' }).fill('900')
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.getByText('Use 600 minutes or less.')).toBeVisible()
  await expect(page.getByTestId('block-row')).toHaveCount(0)
})
