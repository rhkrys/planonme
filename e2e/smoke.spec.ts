import { test, expect } from '@playwright/test'

test('app loads with the main navigation', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible()
})

test('audience page loads', async ({ page }) => {
  await page.goto('/audience.html')
  await expect(page.getByTestId('audience')).toBeAttached()
})
