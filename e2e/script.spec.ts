import { test, expect } from '@playwright/test'

test('write a script with cues, see problems and keep it after reload', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByRole('combobox', { name: 'Current workshop' })
  await expect(picker).toBeEnabled()
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('textbox', { name: 'Workshop name' }).fill('Script test')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(picker.locator('option:checked')).toHaveText('Script test')

  for (const title of ['Welcome', 'Sketching']) {
    await page.getByRole('textbox', { name: 'New block title' }).fill(title)
    await page.getByRole('textbox', { name: 'New block minutes' }).fill('10')
    await page.getByRole('button', { name: 'Add block' }).click()
    await expect(page.locator('.block-title', { hasText: title })).toBeVisible()
  }

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Script' })
    .click()
  await expect(page.getByRole('heading', { name: 'Script', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /^Sketching/ }).click()

  const text = page.getByRole('textbox', { name: 'Script for Sketching' })
  await text.click()
  await text.pressSequentially('Pens up. [')
  const list = page.getByRole('listbox', { name: 'Cue suggestions' })
  await expect(list).toBeVisible()
  await text.pressSequentially('ti')
  await text.press('ArrowDown')
  await text.press('ArrowDown')
  await text.press('ArrowDown')
  await expect(list.getByRole('option', { selected: true })).toContainText('TIMER 5m')
  await text.press('Enter')
  await expect(list).toBeHidden()
  await text.pressSequentially(' [STOP MUSIC]\n[SFX gong] [TIMER 5x] [SLIDE 3]')
  await expect(text).toHaveValue(
    'Pens up. [TIMER 5m] [STOP MUSIC]\n[SFX gong] [TIMER 5x] [SLIDE 3]',
  )

  const preview = page.getByTestId('script-preview')
  await expect(preview.getByTestId('cue')).toHaveText(['[TIMER 5m]', '[STOP MUSIC]'])
  await expect(preview.getByTestId('cue-bad')).toHaveText(['[SFX gong]', '[TIMER 5x]', '[SLIDE 3]'])
  const problems = page.getByRole('list', { name: 'Cue problems' }).getByRole('button')
  await expect(problems).toHaveCount(3)
  await expect(problems.nth(0)).toContainText('There is no sound named "gong".')
  await expect(problems.nth(1)).toContainText('Use a time such as 5m, 30s or 1m30s.')
  await expect(problems.nth(2)).toContainText('There are no slides yet.')
  await expect(page.getByRole('button', { name: /^Sketching/ })).toContainText('3 problems')

  await expect(page.getByTestId('save-state')).toHaveText('All changes saved')
  await page.reload()
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Script' })
    .click()
  await page.getByRole('button', { name: /^Sketching/ }).click()
  await expect(page.getByRole('textbox', { name: 'Script for Sketching' })).toHaveValue(
    'Pens up. [TIMER 5m] [STOP MUSIC]\n[SFX gong] [TIMER 5x] [SLIDE 3]',
  )
  await expect(page.getByRole('textbox', { name: 'Script for Welcome' })).toHaveCount(0)
})
