// @vitest-environment node
import { sniffAudioType } from '../audio/files'
import { hotkeyRule } from '../audio/hotkeys'
import { checkScript } from '../cues/check'
import { parseScript } from '../cues/parse'
import { fakePngBytes } from '../test/media'
import { buildSampleWorkshop, SAMPLE_SLIDES, SAMPLE_TITLE } from './sampleWorkshop'

const fakeRender = async () => new Blob([fakePngBytes()], { type: 'image/png' })

test('the sample has blocks that fill the session and one slide per sample slide', async () => {
  const sample = await buildSampleWorkshop(fakeRender)
  expect(sample.title).toBe(SAMPLE_TITLE)
  expect(sample.blocks.length).toBeGreaterThanOrEqual(3)
  expect(sample.blocks.reduce((sum, b) => sum + b.durationMin, 0)).toBe(sample.durationMin)
  expect(new Set(sample.blocks.map((b) => b.id)).size).toBe(sample.blocks.length)
  expect(sample.decks).toHaveLength(1)
  expect(sample.decks[0]?.slides).toHaveLength(SAMPLE_SLIDES.length)
})

test('every cue in the sample script points at a real slide or sound', async () => {
  const sample = await buildSampleWorkshop(fakeRender)
  const context = {
    slideCount: SAMPLE_SLIDES.length,
    sounds: sample.sounds.map((s, i) => ({ id: `s${i}`, name: s.name, kind: s.kind })),
  }
  const kinds = new Set<string>()
  for (const block of sample.blocks) {
    const parsed = parseScript(block.script)
    expect(parsed.invalid).toEqual([])
    expect(checkScript(parsed, context)).toEqual([])
    for (const c of parsed.cues) kinds.add(c.cue.type)
  }
  // The sample shows off every kind of cue.
  expect([...kinds].sort()).toEqual(['music', 'sfx', 'slide', 'stopMusic', 'timer'])
  // Every slide is used.
  const slides = sample.blocks.flatMap((b) =>
    parseScript(b.script).cues.flatMap((c) => (c.cue.type === 'slide' ? [c.cue.slide] : [])),
  )
  expect(slides).toEqual([1, 2, 3, 4, 5])
})

test('the sample sounds are real WAV files with usable hotkeys', async () => {
  const sample = await buildSampleWorkshop(fakeRender)
  const keys = sample.sounds.map((s) => s.hotkey)
  expect(new Set(keys).size).toBe(keys.length)
  for (const sound of sample.sounds) {
    expect(sound.blob.type).toBe('audio/wav')
    const head = new Uint8Array(await sound.blob.slice(0, 12).arrayBuffer())
    expect(sniffAudioType(head)).toBe('audio/wav')
    expect(hotkeyRule(sound.hotkey)).toBeNull()
    expect(sound.blob.size).toBeLessThan(1024 * 1024)
  }
  expect(sample.sounds.some((s) => s.kind === 'music' && s.loop)).toBe(true)
})

test('a slide that can not be drawn fails the whole build', async () => {
  await expect(
    buildSampleWorkshop(async () => {
      throw new Error('no canvas')
    }),
  ).rejects.toThrow('no canvas')
})
