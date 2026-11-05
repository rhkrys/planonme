import { test, expect, type Page } from '@playwright/test'
import { makeWav } from '../src/test/media'

// Node's Buffer, typed here because this project does not include @types/node.
declare const Buffer: { from(data: Uint8Array | string): never }

async function addSounds(
  page: Page,
  files: { name: string; bytes: Uint8Array | string; type?: string }[],
) {
  // The file button is disabled until the sounds have loaded.
  await expect(page.getByLabel('Choose audio files')).toBeEnabled()
  await page.getByLabel('Choose audio files').setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: f.type ?? 'audio/wav',
      buffer: Buffer.from(f.bytes),
    })),
  )
}

function pad(page: Page, name: string) {
  return page.getByTestId('pad').filter({ has: page.getByRole('button', { name: `Play ${name}` }) })
}

test('upload sounds, play them with clicks and hotkeys, crossfade music and stop all', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Current workshop' })).toBeEnabled()
  await page.getByRole('button', { name: 'Sounds' }).click()
  await expect(page.getByText('No sounds yet.')).toBeVisible()

  await page.getByRole('combobox', { name: 'Add as' }).selectOption('sfx')
  await addSounds(page, [{ name: 'Applause.wav', bytes: makeWav(1.5, 8000, 660) }])
  await expect(page.getByRole('status')).toContainText('Added "Applause".')
  await expect(page.getByTestId('pad')).toHaveCount(1)

  // A file that is not audio, and one that does not decode, show errors.
  await addSounds(page, [
    { name: 'broken.wav', bytes: 'RIFF this is not really a wave file' },
    { name: 'Bell.wav', bytes: makeWav(0.5, 8000, 880) },
  ])
  await expect(page.getByRole('alert')).toContainText(
    '"broken.wav": This file could not be read as audio.',
  )
  await expect(page.getByTestId('pad')).toHaveCount(2)
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()

  await page.getByRole('combobox', { name: 'Add as' }).selectOption('music')
  await addSounds(page, [
    { name: 'Intro.wav', bytes: makeWav(6, 8000, 220) },
    { name: 'Outro.wav', bytes: makeWav(6, 8000, 330) },
  ])
  await expect(page.getByRole('status')).toContainText('Added 2 sounds.')
  await expect(page.getByTestId('pad')).toHaveCount(4)
  await expect(pad(page, 'Intro')).toContainText('Music, loops')

  // Give Applause the hotkey A.
  await page.getByRole('button', { name: 'Edit Applause' }).click()
  const form = page.getByRole('form', { name: 'Edit sound Applause' })
  await form.getByRole('textbox', { name: 'Hotkey' }).press('b')
  await expect(form).toContainText('B is kept for the blank screen.')
  await form.getByRole('textbox', { name: 'Hotkey' }).press('a')
  await form.getByRole('combobox', { name: 'Sound color' }).selectOption('Red')
  await form.getByRole('button', { name: 'Save sound' }).click()
  await expect(form).toBeHidden()
  await expect(pad(page, 'Applause').locator('kbd')).toHaveText('A')

  // Click a pad: it plays, shows its state, and ends by itself.
  await page.getByRole('button', { name: 'Play Applause' }).click()
  await expect(pad(page, 'Applause')).toHaveAttribute('data-playing', 'true')
  await expect(pad(page, 'Applause').getByTestId('pad-state')).toHaveText('Playing')
  await expect(pad(page, 'Applause')).toHaveAttribute('data-playing', 'false', { timeout: 5000 })

  // The hotkey plays it too, and two presses overlap.
  await page.getByRole('heading', { name: 'Sounds', exact: true }).click()
  await page.keyboard.press('a')
  await page.keyboard.press('a')
  await expect(page.getByTestId('playing-count')).toHaveText('1 sound playing')
  await expect(pad(page, 'Applause')).toHaveAttribute('data-playing', 'true')

  // Music: starting Outro crossfades from Intro.
  await page.getByRole('button', { name: 'Play Intro' }).click()
  await expect(pad(page, 'Intro')).toHaveAttribute('data-playing', 'true')
  await page.getByRole('button', { name: 'Play Outro' }).click()
  await expect(pad(page, 'Outro')).toHaveAttribute('data-playing', 'true')
  await expect(pad(page, 'Intro').getByTestId('pad-state')).toHaveText(/Stopping|^$/)
  await expect(pad(page, 'Intro').getByTestId('pad-state')).toHaveText('', { timeout: 5000 })
  await expect(pad(page, 'Outro')).toHaveAttribute('data-playing', 'true')

  // Typing in a field does not fire hotkeys.
  await expect(pad(page, 'Applause')).toHaveAttribute('data-playing', 'false', { timeout: 5000 })
  await page.getByRole('button', { name: 'Edit Bell' }).click()
  await page.getByRole('textbox', { name: 'Sound name' }).press('a')
  await page.waitForTimeout(300)
  await expect(pad(page, 'Applause')).toHaveAttribute('data-playing', 'false')
  await expect(page.getByTestId('playing-count')).toHaveText('1 sound playing')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Escape is the panic button.
  await page.getByRole('button', { name: 'Play Applause' }).click()
  await expect(page.getByTestId('playing-count')).toHaveText('2 sounds playing')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('playing-count')).toHaveText('Nothing playing')

  // Sounds and settings survive a reload.
  await page.reload()
  await page.getByRole('button', { name: 'Sounds' }).click()
  await expect(page.getByTestId('pad')).toHaveCount(4)
  await expect(pad(page, 'Applause').locator('kbd')).toHaveText('A')
  // Hotkeys work on other views too.
  await page.getByRole('button', { name: 'Plan' }).click()
  await page.getByRole('heading', { level: 1 }).first().click()
  await page.keyboard.press('a')
  await page.getByRole('button', { name: 'Sounds' }).click()
  await expect(page.getByTestId('playing-count')).toHaveText('1 sound playing')
  await page.getByRole('button', { name: 'Stop all (Esc)' }).click()
  await expect(page.getByTestId('playing-count')).toHaveText('Nothing playing')

  // Delete a sound.
  await page.getByRole('button', { name: 'Delete Bell' }).click()
  await page.getByRole('button', { name: 'Delete sound' }).click()
  await expect(page.getByTestId('pad')).toHaveCount(3)

  // A recording with no type and no file extension is recognized by its bytes.
  await addSounds(page, [{ name: 'Voice memo', bytes: makeWav(0.5, 8000, 500), type: '' }])
  await expect(page.getByTestId('pad')).toHaveCount(4)
  await page.getByRole('button', { name: 'Play Voice memo' }).click()
  await expect(pad(page, 'Voice memo')).toHaveAttribute('data-playing', 'true')
})
