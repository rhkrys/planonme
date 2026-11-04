import { test, expect } from '@playwright/test'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(text: string): never }

test('manage workshops and remember the current one after reload', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toHaveValue(/.+/)
  await expect(picker.locator('option:checked')).toHaveText('My workshop')

  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Kickoff')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Kickoff')

  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Kickoff day')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Kickoff day')

  await page.reload()
  await expect(picker.locator('option:checked')).toHaveText('Kickoff day')

  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('group', { name: 'Confirm delete' })).toContainText('Kickoff day')
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(picker.locator('option:checked')).toHaveText('My workshop')
  await expect(picker.locator('option')).toHaveCount(1)
})

test('export a workshop and import it back', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker.locator('option:checked')).toHaveText('My workshop')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('my-workshop.planonme')
  const path = await download.path()

  await page.getByLabel('Import backup file').setInputFiles(path)
  await expect(page.getByRole('status')).toContainText('Imported "My workshop (2)"')
  await expect(picker.locator('option:checked')).toHaveText('My workshop (2)')
  await expect(picker.locator('option')).toHaveCount(2)
})

test('a broken import file shows an error and the app keeps working', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'broken.planonme',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"planonme","version":1,"workshop":'),
  })
  await expect(page.getByRole('alert')).toContainText('damaged or cut off')
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sounds' }).click()
  await expect(page.getByRole('heading', { name: 'Sounds' })).toBeVisible()
})
