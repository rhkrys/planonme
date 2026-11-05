// @vitest-environment node
import { makeWav } from '../test/media'
import { PlanOnMeDB } from './db'
import { LIMITS } from './limits'
import {
  addSlideDeck,
  addSound,
  createWorkshop,
  deleteSound,
  getWorkshop,
  listSounds,
  MediaLimitError,
  SoundNotFoundError,
  SoundSettingsError,
  updateSound,
  WorkshopNotFoundError,
} from './repo'
import type { Sound } from './types'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`sound-test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

function newSound(patch: Partial<Sound> = {}): Omit<Sound, 'id' | 'workshopId'> {
  return {
    name: 'Ding',
    kind: 'sfx',
    blob: new Blob([makeWav()], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
    ...patch,
  }
}

async function sounds(workshopId: string): Promise<Sound[]> {
  const w = await getWorkshop(db, workshopId)
  if (!w) throw new Error('no workshop')
  return listSounds(db, w)
}

test('adds, updates and deletes sounds', async () => {
  const w = await createWorkshop(db, 'Sounds')
  const a = await addSound(db, w.id, newSound({ name: ' [Intro]  theme ', hotkey: 'Q' }))
  expect(a.name).toBe('(Intro) theme')
  expect(a.hotkey).toBe('q')
  const b = await addSound(db, w.id, newSound({ name: 'ding' }))
  const c = await addSound(db, w.id, newSound({ name: 'DING' }))
  expect(b.name).toBe('ding')
  expect(c.name).toBe('DING 2')
  expect((await getWorkshop(db, w.id))?.soundIds).toEqual([a.id, b.id, c.id])

  const saved = await updateSound(db, w.id, b.id, {
    name: 'Gong',
    kind: 'music',
    loop: true,
    volume: 1.7,
    hotkey: 'G',
    color: '#AABBCC',
  })
  expect(saved).toMatchObject({
    name: 'Gong',
    kind: 'music',
    loop: true,
    volume: 1,
    hotkey: 'g',
    color: '#aabbcc',
  })
  expect((await sounds(w.id))[1]).toMatchObject({ name: 'Gong', hotkey: 'g' })

  await deleteSound(db, w.id, a.id)
  expect((await sounds(w.id)).map((s) => s.name)).toEqual(['Gong', 'DING 2'])
  expect((await getWorkshop(db, w.id))?.soundIds).toEqual([b.id, c.id])
  expect(await db.sounds.get(a.id)).toBeUndefined()
})

test('bad settings are refused with readable messages', async () => {
  const w = await createWorkshop(db, 'Sounds')
  const a = await addSound(db, w.id, newSound({ name: 'Applause', hotkey: 'a' }))
  const b = await addSound(db, w.id, newSound({ name: 'Gong' }))

  await expect(addSound(db, w.id, newSound({ hotkey: 'A' }))).rejects.toThrow(
    '"Applause" already uses this key.',
  )
  await expect(addSound(db, w.id, newSound({ hotkey: 'b' }))).rejects.toBeInstanceOf(
    SoundSettingsError,
  )
  await expect(updateSound(db, w.id, b.id, { hotkey: 'a' })).rejects.toThrow(/already uses/)
  await expect(updateSound(db, w.id, b.id, { hotkey: ' ' })).rejects.toThrow(/GO/)
  await expect(updateSound(db, w.id, b.id, { name: ' applause ' })).rejects.toThrow(
    'Another sound is already called "applause".',
  )
  await expect(updateSound(db, w.id, b.id, { color: 'red' })).rejects.toThrow(/#ff8800/)
  await expect(updateSound(db, w.id, b.id, { volume: Number.NaN })).rejects.toThrow(/number/)
  // Keeping its own hotkey and name is fine.
  await expect(updateSound(db, w.id, a.id, { hotkey: 'a', name: 'Applause' })).resolves.toBeTruthy()

  await expect(
    addSound(db, w.id, newSound({ blob: new Blob(['x'], { type: 'text/plain' }) })),
  ).rejects.toThrow(/audio type/)
  await expect(
    addSound(
      db,
      w.id,
      newSound({
        blob: new Blob([new Uint8Array(LIMITS.maxSoundBytes + 1)], { type: 'audio/wav' }),
      }),
    ),
  ).rejects.toBeInstanceOf(MediaLimitError)
  await expect(addSound(db, 'missing', newSound())).rejects.toBeInstanceOf(WorkshopNotFoundError)
  await expect(updateSound(db, w.id, 'missing', { name: 'x' })).rejects.toBeInstanceOf(
    SoundNotFoundError,
  )

  // A sound of another workshop cannot be changed or deleted through this one.
  const other = await createWorkshop(db, 'Other')
  await expect(updateSound(db, other.id, a.id, { name: 'x' })).rejects.toBeInstanceOf(
    SoundNotFoundError,
  )
  await expect(deleteSound(db, other.id, a.id)).rejects.toBeInstanceOf(SoundNotFoundError)
  expect((await sounds(w.id)).map((s) => s.name)).toEqual(['Applause', 'Gong'])
})

test('a workshop has a cap on sound count and total size', async () => {
  const w = await createWorkshop(db, 'Full')
  const big = new Blob([new Uint8Array(LIMITS.maxSoundBytes)], { type: 'audio/wav' })
  const perFile = LIMITS.maxSoundBytes
  const fit = Math.floor(LIMITS.maxSoundBytesTotal / perFile)
  for (let i = 0; i < fit; i++) await addSound(db, w.id, newSound({ blob: big }))
  await expect(addSound(db, w.id, newSound({ blob: big }))).rejects.toThrow(/MB of sounds/)

  const w2 = await createWorkshop(db, 'Many')
  const stored = await getWorkshop(db, w2.id)
  if (!stored) throw new Error('no workshop')
  await db.workshops.put({
    ...stored,
    soundIds: Array.from({ length: LIMITS.maxSounds }, (_, i) => `s${i}`),
  })
  await expect(addSound(db, w2.id, newSound())).rejects.toThrow(/up to 200 sounds/)
})

test('slides and sounds together stay small enough to export', async () => {
  const w = await createWorkshop(db, 'Full')
  const big = new Blob([new Uint8Array(LIMITS.maxSoundBytes)], { type: 'audio/wav' })
  for (let i = 0; i < 3; i++) await addSound(db, w.id, newSound({ blob: big }))
  const slide = new Blob([new Uint8Array(LIMITS.maxSlideBytes)], { type: 'image/png' })
  const room = Math.floor((LIMITS.maxMediaBytes - 3 * LIMITS.maxSoundBytes) / LIMITS.maxSlideBytes)
  const deck = (count: number) => ({
    name: 'Deck',
    source: 'pdf' as const,
    slides: new Array<Blob>(count).fill(slide),
  })
  await expect(addSlideDeck(db, w.id, deck(room + 1))).rejects.toThrow(/fits in a backup file/)
  await addSlideDeck(db, w.id, deck(room))
  const w2 = await createWorkshop(db, 'Slides first')
  await addSlideDeck(db, w2.id, deck(Math.floor(LIMITS.maxMediaBytes / LIMITS.maxSlideBytes)))
  await expect(addSound(db, w2.id, newSound({ blob: big }))).rejects.toBeInstanceOf(MediaLimitError)
})
