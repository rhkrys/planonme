// @vitest-environment node
import { fakePngBytes, makeWav } from '../test/media'
import { bytesToBase64 } from './base64'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  backupFilename,
  exportWorkshop,
  importWorkshop,
  parseBackup,
  readBackupFile,
} from './backup'
import { PlanOnMeDB } from './db'
import { LIMITS } from './limits'
import {
  addSlideDeck,
  addSound,
  createWorkshop,
  getWorkshop,
  listSlideDecks,
  listSounds,
  listWorkshops,
  saveWorkshop,
} from './repo'

let db: PlanOnMeDB
let n = 0
beforeEach(() => {
  db = new PlanOnMeDB(`backup-test-${++n}`)
})
afterEach(async () => {
  await db.delete()
})

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

function jsonFile(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}

const png = fakePngBytes()
const wav = makeWav()

/** A small valid backup object for hostile edits. */
function validBackup() {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2025-01-01T00:00:00.000Z',
    workshop: {
      title: 'Team day',
      date: '2025-03-14',
      durationMin: 120,
      blocks: [
        {
          id: 'b1',
          title: 'Welcome',
          kind: 'talk',
          durationMin: 10,
          goal: 'Set the tone',
          notes: '',
          script: 'Hi [SLIDE 1]',
        },
      ],
    },
    slideDecks: [
      {
        id: 'd1',
        name: 'Main',
        source: 'pdf',
        slides: [{ type: 'image/png', data: bytesToBase64(png) }],
      },
    ],
    sounds: [
      {
        id: 's1',
        name: 'Applause',
        kind: 'sfx',
        type: 'audio/wav',
        data: bytesToBase64(wav),
        loop: false,
        volume: 0.8,
        hotkey: 'a',
        color: '#ff8800',
      },
    ],
  }
}

async function expectRejected(file: Blob, message: RegExp) {
  const before = await db.workshops.count()
  const err = await importWorkshop(db, file).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(BackupError)
  expect((err as Error).message).toMatch(message)
  expect(await db.workshops.count()).toBe(before)
  expect(await db.slideDecks.count()).toBe(0)
  expect(await db.sounds.count()).toBe(0)
}

test('export then import round trips a workshop with media and new ids', async () => {
  const w = await createWorkshop(db, 'Team day: "Q3" plan')
  await saveWorkshop(db, {
    ...w,
    date: '2025-03-14',
    durationMin: 150,
    blocks: [
      {
        id: 'b1',
        title: 'Welcome',
        kind: 'talk',
        durationMin: 10,
        goal: 'Warm up',
        notes: 'Smile',
        script: 'Hello [SLIDE 1] [SFX Applause]',
      },
      {
        id: 'b2',
        title: 'Break',
        kind: 'break',
        durationMin: 15,
        goal: '',
        notes: '',
        script: '[MUSIC Lounge]',
      },
    ],
  })
  const png2 = fakePngBytes(1000)
  await addSlideDeck(db, w.id, {
    name: 'Main deck',
    source: 'gslides',
    slides: [new Blob([png], { type: 'image/png' }), new Blob([png2], { type: 'image/png' })],
  })
  await addSlideDeck(db, w.id, { name: 'Empty', source: 'pdf', slides: [] })
  await addSound(db, w.id, {
    name: 'Applause',
    kind: 'sfx',
    blob: new Blob([wav], { type: 'audio/wav' }),
    loop: false,
    volume: 0.5,
    hotkey: 'a',
    color: '#00ff00',
  })
  await addSound(db, w.id, {
    name: 'Lounge',
    kind: 'music',
    blob: new Blob([makeWav(0.2)], { type: 'audio/wav' }),
    loop: true,
    volume: 1,
    hotkey: '',
    color: '',
  })

  const { filename, blob } = await exportWorkshop(db, w.id)
  expect(filename).toBe('team-day-q3-plan.planonme')
  const json = JSON.parse(await blob.text())
  expect(json.format).toBe('planonme')
  expect(json.version).toBe(1)

  const imported = await importWorkshop(db, blob)
  const original = await getWorkshop(db, w.id)
  expect(original).not.toBeNull()
  if (!original) return
  expect(imported.id).not.toBe(original.id)
  expect(imported.title).toBe('Team day: "Q3" plan (2)')
  expect(imported.date).toBe('2025-03-14')
  expect(imported.durationMin).toBe(150)
  expect(imported.blocks.map((b) => [b.title, b.kind, b.durationMin, b.script])).toEqual(
    original.blocks.map((b) => [b.title, b.kind, b.durationMin, b.script]),
  )
  for (const b of imported.blocks) expect(['b1', 'b2']).not.toContain(b.id)

  const stored = await getWorkshop(db, imported.id)
  expect(stored).toEqual(imported)

  const decksA = await listSlideDecks(db, original)
  const decksB = await listSlideDecks(db, imported)
  expect(decksB.map((d) => [d.name, d.source, d.slides.length])).toEqual([
    ['Main deck', 'gslides', 2],
    ['Empty', 'pdf', 0],
  ])
  for (const d of decksB) {
    expect(decksA.map((x) => x.id)).not.toContain(d.id)
    expect(d.workshopId).toBe(imported.id)
  }
  expect(await bytesOf(decksB[0]?.slides[1] ?? new Blob())).toEqual(Array.from(png2))
  expect(decksB[0]?.slides[0]?.type).toBe('image/png')

  const soundsA = await listSounds(db, original)
  const soundsB = await listSounds(db, imported)
  expect(soundsB.map((s) => [s.name, s.kind, s.loop, s.volume, s.hotkey, s.color])).toEqual(
    soundsA.map((s) => [s.name, s.kind, s.loop, s.volume, s.hotkey, s.color]),
  )
  for (let i = 0; i < soundsA.length; i++) {
    const a = soundsA[i]
    const b = soundsB[i]
    if (!a || !b) throw new Error('missing sound')
    expect(b.id).not.toBe(a.id)
    expect(b.blob.type).toBe('audio/wav')
    expect(await bytesOf(b.blob)).toEqual(await bytesOf(a.blob))
  }
  expect(imported.slideDeckIds).toEqual(decksB.map((d) => d.id))
  expect(imported.soundIds).toEqual(soundsB.map((s) => s.id))
})

test('imports a hand built valid file', async () => {
  const w = await importWorkshop(db, jsonFile(validBackup()))
  expect(w.title).toBe('Team day')
  expect((await listWorkshops(db)).map((x) => x.title)).toEqual(['Team day'])
})

test('makes safe file names', () => {
  expect(backupFilename('')).toBe('workshop.planonme')
  expect(backupFilename('../../etc/passwd')).toBe('etcpasswd.planonme')
  expect(backupFilename('Café  Day')).toBe('cafe-day.planonme')
})

test('rejects empty, truncated and non JSON files', async () => {
  await expectRejected(new Blob([]), /empty/)
  const full = JSON.stringify(validBackup())
  await expectRejected(new Blob([full.slice(0, full.length / 2)]), /damaged or cut off/)
  await expectRejected(new Blob(['hello']), /damaged or cut off/)
  await expectRejected(new Blob(['['.repeat(200_000)]), /damaged or cut off/)
  await expectRejected(jsonFile([1, 2, 3]), /not valid/)
  await expectRejected(jsonFile(null), /not valid/)
})

test('rejects wrong format and versions', async () => {
  await expectRejected(jsonFile({ ...validBackup(), format: 'other' }), /not a PlanOnMe backup/)
  await expectRejected(jsonFile({ ...validBackup(), version: '1' }), /no valid format version/)
  await expectRejected(jsonFile({ ...validBackup(), version: 1.5 }), /no valid format version/)
  await expectRejected(jsonFile({ ...validBackup(), version: 2 }), /newer version/)
  await expectRejected(jsonFile({ ...validBackup(), version: 0 }), /not supported/)
})

test('rejects wrong types anywhere', async () => {
  const cases: Array<[(b: ReturnType<typeof validBackup>) => void, RegExp]> = [
    [(b) => ((b.workshop as Record<string, unknown>).title = 5), /Workshop title must be text/],
    [(b) => ((b.workshop as Record<string, unknown>).durationMin = '60'), /whole number/],
    [(b) => (b.workshop.durationMin = -1), /between/],
    [(b) => (b.workshop.durationMin = 1e12), /between/],
    [(b) => (b.workshop.date = 'tomorrow'), /date/],
    [(b) => ((b.workshop as Record<string, unknown>).blocks = {}), /Blocks must be a list/],
    [(b) => ((b.workshop.blocks as unknown[])[0] = 'x'), /Block 1 is not valid/],
    [(b) => ((b.workshop.blocks[0] as Record<string, unknown>).kind = 'nap'), /Block 1 kind/],
    [(b) => ((b.workshop.blocks[0] as Record<string, unknown>).script = null), /script/],
    [(b) => ((b as Record<string, unknown>).slideDecks = undefined), /Slide decks must be a list/],
    [(b) => ((b.slideDecks[0] as Record<string, unknown>).source = 'keynote'), /source/],
    [(b) => ((b.slideDecks[0] as Record<string, unknown>).slides = 'x'), /slides must be a list/],
    [
      (b) => ((b.slideDecks[0]?.slides[0] as Record<string, unknown>).type = 'image/svg+xml'),
      /type/,
    ],
    [(b) => ((b.slideDecks[0]?.slides[0] as Record<string, unknown>).data = 42), /base64 text/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).type = 'text/html'), /audio type/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).volume = 2), /volume/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).volume = 'loud'), /volume/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).loop = 'yes'), /loop/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).color = 'red'), /color/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).kind = 'noise'), /kind/],
    [(b) => ((b.sounds[0] as Record<string, unknown>).name = ['x']), /name must be text/],
    [(b) => ((b.workshop as Record<string, unknown>).title = 'x'.repeat(10_000)), /too long/],
  ]
  for (const [mutate, message] of cases) {
    const b = validBackup()
    mutate(b)
    await expectRejected(jsonFile(b), message)
  }
})

test('rejects bad base64 and media that does not match its type', async () => {
  const cases: Array<[string, RegExp]> = [
    ['not base64!', /not valid base64/],
    ['abc', /not valid base64/],
    ['ab=c', /not valid base64/],
    ['', /empty/],
    [bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6])), /not a valid image\/png file/],
  ]
  for (const [data, message] of cases) {
    const b = validBackup()
    const slide = b.slideDecks[0]?.slides[0]
    if (slide) slide.data = data
    await expectRejected(jsonFile(b), message)
  }
  const b = validBackup()
  const sound = b.sounds[0]
  if (sound) sound.data = 'QUJD\nREVG'
  await expectRejected(jsonFile(b), /Sound 1 audio is not valid base64/)
})

test('rejects huge counts before doing any work', async () => {
  const blocks = validBackup()
  blocks.workshop.blocks = new Array(LIMITS.maxBlocks + 1).fill(blocks.workshop.blocks[0])
  await expectRejected(jsonFile(blocks), /Blocks has too many items/)

  const decks = validBackup()
  ;(decks as Record<string, unknown>).slideDecks = new Array(1_000_000).fill(null)
  await expectRejected(jsonFile(decks), /Slide decks has too many items/)

  const sounds = validBackup()
  ;(sounds as Record<string, unknown>).sounds = new Array(LIMITS.maxSounds + 1).fill(0)
  await expectRejected(jsonFile(sounds), /Sounds has too many items/)

  const slides = validBackup()
  const slide = slides.slideDecks[0]?.slides[0]
  slides.slideDecks = new Array(5).fill({
    name: 'D',
    source: 'pdf',
    slides: new Array(LIMITS.maxSlidesPerDeck).fill(slide),
  })
  await expectRejected(jsonFile(slides), /too many slides/)
})

test('rejects oversized media and files', async () => {
  // One slide just over the per slide cap.
  const big = 'A'.repeat((Math.ceil(LIMITS.maxSlideBytes / 3) + 1) * 4)
  const one = validBackup()
  const slide = one.slideDecks[0]?.slides[0]
  if (slide) slide.data = big
  expect(() => parseBackup(one)).toThrow(/too large/)

  // Many slides each under the cap, but over the total media cap. They share one string.
  const each = 'A'.repeat(Math.floor(LIMITS.maxSlideBytes / 3) * 4)
  const count = Math.floor(LIMITS.maxMediaBytes / LIMITS.maxSlideBytes) + 2
  const many = validBackup()
  many.slideDecks = [
    {
      id: 'd',
      name: 'Big',
      source: 'pdf',
      slides: new Array(count).fill({ type: 'image/png', data: each }),
    },
  ]
  expect(() => parseBackup(many)).toThrow(/more than 500 MB of media/)

  // The file size is checked before reading it.
  const huge = { size: LIMITS.maxFileBytes + 1, text: () => Promise.reject(new Error('no')) }
  await expect(readBackupFile(huge as unknown as Blob)).rejects.toThrow(/too large/)
})

test('a file that fails to read gives a readable error', async () => {
  const broken = { size: 10, text: () => Promise.reject(new Error('disk')) }
  await expect(readBackupFile(broken as unknown as Blob)).rejects.toThrow(/could not be read/)
})

test('ignores unknown fields and prototype tricks', async () => {
  const text = JSON.stringify(validBackup()).replace(
    '"format"',
    '"__proto__":{"polluted":true},"extra":1,"format"',
  )
  const w = await importWorkshop(db, new Blob([text]))
  expect(w.title).toBe('Team day')
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(Object.keys(w)).not.toContain('extra')
})

test('export labels slides by their bytes, so a stored slide with no type still round trips', async () => {
  const w = await createWorkshop(db, 'Typeless')
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  await addSlideDeck(db, w.id, { name: 'Deck', source: 'pdf', slides: [new Blob([jpeg])] })
  const file = await exportWorkshop(db, w.id)
  const imported = await importWorkshop(db, file.blob)
  const [deck] = await listSlideDecks(db, imported)
  expect(deck?.slides[0]?.type).toBe('image/jpeg')
  expect(await bytesOf(deck?.slides[0] ?? new Blob())).toEqual(Array.from(jpeg))
})

test('export refuses media that import would reject, with a clear message', async () => {
  const w = await createWorkshop(db, 'Odd media')
  await addSlideDeck(db, w.id, {
    name: 'Deck',
    source: 'pdf',
    slides: [new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' })],
  })
  const err = await exportWorkshop(db, w.id).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(BackupError)
  expect((err as Error).message).toMatch(/not a PNG, JPEG or WebP image/)
})

test('export refuses a sound larger than import allows', async () => {
  const w = await createWorkshop(db, 'Big sound')
  await addSound(db, w.id, {
    name: 'Long',
    kind: 'music',
    blob: new Blob([new Uint8Array(LIMITS.maxSoundBytes + 1)], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
  })
  const err = await exportWorkshop(db, w.id).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(BackupError)
  expect((err as Error).message).toMatch(/Sound 1 is larger than 100 MB/)
})
