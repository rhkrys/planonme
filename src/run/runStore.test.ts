import type { SlidePos } from '../slides/decks'
import { last } from '../test/fakeChannel'
import { createRunStore, parseSavedRun, skippedNote, type RunDeps } from './runStore'
import { buildRunPlan, type BlockInput } from './sequencer'

const decks = [
  { id: 'd1', name: 'Intro', slideCount: 2 },
  { id: 'd2', name: 'Main', slideCount: 2 },
]
const media = { decks, sounds: [{ name: 'Applause', kind: 'sfx' as const }] }

function block(id: string, script: string, durationMin = 10): BlockInput {
  return { id, title: id, kind: 'talk', durationMin, script }
}

function setup(blocks: BlockInput[], extra: Partial<RunDeps> = {}) {
  let now = 1_000_000
  let audience: SlidePos | null = null
  const shown: SlidePos[] = []
  const played: unknown[] = []
  const plan = buildRunPlan(blocks, media)
  const deps: RunDeps = {
    getPlan: () => plan,
    getDecks: () => decks,
    currentSlide: () => audience,
    showSlide: (pos) => {
      audience = pos
      shown.push(pos)
    },
    playCue: (cue) => {
      played.push(cue)
      return Promise.resolve(true)
    },
    now: () => now,
    ...extra,
  }
  const store = createRunStore(deps)
  store.getState().syncWorkshop('w1')
  return {
    store,
    shown,
    played,
    tick: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}

test('GO fires slides, sounds and timers in order and starts the clock', () => {
  const t = setup([block('a', '[SLIDE 3] [SFX applause] [STOP MUSIC] [TIMER 1m]')])
  const s = () => t.store.getState()
  expect(s().clock.running).toBe(false)
  s().go()
  expect(t.shown).toEqual([{ deckId: 'd2', index: 0 }])
  expect(s().clock.running).toBe(true)
  s().go()
  s().go()
  expect(t.played).toEqual([{ type: 'sfx', name: 'applause' }, { type: 'stopMusic' }])
  s().go()
  expect(s().timer).toEqual({ seconds: 60, startedAt: t.now() })
  s().go()
  expect(s().note).toBe('End of the script. There are no more cues.')
  expect(s().pos.cue).toBe(3)
})

test('Back does not play sounds again but brings back the slide', () => {
  const t = setup([block('a', '[SLIDE 1] [SLIDE 2] [SFX applause]')])
  const s = () => t.store.getState()
  s().go()
  s().go()
  s().go()
  expect(t.played).toHaveLength(1)
  s().back()
  expect(s().pos.cue).toBe(1)
  // The audience already shows slide 2, so nothing is sent.
  expect(t.shown).toHaveLength(2)
  s().back()
  expect(last(t.shown)).toEqual({ deckId: 'd1', index: 0 })
  expect(t.played).toHaveLength(1)
  s().go()
  expect(last(t.shown)).toEqual({ deckId: 'd1', index: 1 })
})

test('skipped cues leave a note and never fire', () => {
  const t = setup([block('a', '[SFX gong] [SLIDE 1] [SLIDE 99] [TIMER 0s] [SLIDE 2]')])
  const s = () => t.store.getState()
  s().go()
  expect(s().note).toBe('Skipped [SFX gong]. There is no sound named "gong".')
  s().go()
  expect(s().note).toBe('Skipped 2 cues that cannot run: [SLIDE 99], [TIMER 0s].')
  expect(t.played).toEqual([])
  expect(t.shown).toHaveLength(2)
  s().clearNote()
  expect(s().note).toBeNull()
})

test('a script without cues says so', () => {
  const t = setup([block('a', 'Only words.')])
  t.store.getState().go()
  expect(t.store.getState().note).toBe('There are no cues in the script.')
})

test('block time restarts when the block changes', () => {
  const t = setup([block('a', '[SLIDE 1]'), block('b', '[SLIDE 2]')])
  const s = () => t.store.getState()
  s().go()
  t.tick(90_000)
  s().go()
  expect(s().pos.block).toBe(1)
  expect(s().blockStartMs).toBe(90_000)
  t.tick(10_000)
  s().jumpToBlock(1)
  expect(s().blockStartMs).toBe(100_000)
  s().jumpToCue(0)
  expect(s().pos).toEqual({ cue: 0, block: 0 })
  expect(last(t.shown)).toEqual({ deckId: 'd1', index: 0 })
})

test('pause, resume and reset the session', () => {
  const t = setup([block('a', '[SLIDE 1] [TIMER 1m]')])
  const s = () => t.store.getState()
  s().startSession()
  t.tick(5000)
  s().pauseSession()
  expect(s().clock).toEqual({ running: false, startedAt: 0, accumulated: 5000 })
  s().go()
  // GO does not resume a paused session.
  expect(s().clock.running).toBe(false)
  s().go()
  expect(s().timer).not.toBeNull()
  s().resetSession()
  expect(s().clock.accumulated).toBe(0)
  expect(s().pos).toEqual({ cue: -1, block: 0 })
  expect(s().timer).toBeNull()
})

test('a new workshop starts a fresh run, the same one keeps it', () => {
  const t = setup([block('a', '[SLIDE 1]')])
  const s = () => t.store.getState()
  s().go()
  s().syncWorkshop('w1')
  expect(s().pos.cue).toBe(0)
  s().syncWorkshop('w2')
  expect(s().pos.cue).toBe(-1)
  expect(s().clock.running).toBe(false)
})

test('text size stays within limits', () => {
  const t = setup([])
  t.store.getState().setFontSize(500)
  expect(t.store.getState().fontSize).toBe(72)
  t.store.getState().setFontSize(Number.NaN)
  expect(t.store.getState().fontSize).toBe(28)
  t.store.getState().setFontSize(2)
  expect(t.store.getState().fontSize).toBe(16)
})

test('skippedNote lists at most five cues', () => {
  const plan = buildRunPlan([block('a', '[SFX a] [SFX b] [SFX c] [SFX d] [SFX e] [SFX f]')], media)
  expect(skippedNote(plan.cues)).toBe(
    'Skipped 6 cues that cannot run: [SFX a], [SFX b], [SFX c], [SFX d], [SFX e] and 1 more.',
  )
  expect(skippedNote([])).toBeNull()
})

test('Back into an earlier block keeps its time, Start here restarts it', () => {
  const t = setup([
    block('a', '[SLIDE 1] [SLIDE 2]'),
    block('b', '[SLIDE 3]'),
    block('c', '[SLIDE 4]'),
  ])
  const s = () => t.store.getState()
  s().go()
  t.tick(60_000)
  s().go()
  t.tick(60_000)
  // An accidental GO into block b, then Back.
  s().go()
  expect(s().pos.block).toBe(1)
  expect(s().blockStartMs).toBe(120_000)
  t.tick(5_000)
  s().back()
  expect(s().pos).toEqual({ cue: 1, block: 0 })
  // Block a still started at the session start, so its countdown does not start over.
  expect(s().blockStartMs).toBe(0)
  // GO into block b again keeps the time it first started.
  s().go()
  expect(s().blockStartMs).toBe(120_000)
  t.tick(5_000)
  s().jumpToCue(0)
  expect(s().blockStartMs).toBe(0)
  // Start here on block a starts it again and forgets the later blocks.
  s().jumpToBlock(0)
  expect(s().blockStartMs).toBe(130_000)
  s().go()
  s().go()
  t.tick(1_000)
  s().go()
  expect(s().pos.block).toBe(1)
  expect(s().blockStartMs).toBe(131_000)
})

test('the run survives a reload of the window', () => {
  let stored: unknown = null
  const saved = {
    load: () => stored,
    save: (run: unknown) => {
      stored = JSON.parse(JSON.stringify(run))
    },
  }
  const blocks = [block('a', '[SLIDE 1]'), block('b', '[SLIDE 2] [TIMER 1m]')]
  const t = setup(blocks, { saved })
  const s = () => t.store.getState()
  s().go()
  t.tick(30_000)
  s().go()
  s().go()
  const before = { pos: s().pos, clock: s().clock, timer: s().timer, start: s().blockStartMs }

  const again = createRunStore(depsWith(saved, t.now))
  again.getState().syncWorkshop('w1')
  expect(again.getState().pos).toEqual(before.pos)
  expect(again.getState().clock).toEqual(before.clock)
  expect(again.getState().timer).toEqual(before.timer)
  expect(again.getState().blockStartMs).toBe(before.start)

  // Another workshop does not pick up this run.
  const other = createRunStore(depsWith(saved, t.now))
  other.getState().syncWorkshop('w2')
  expect(other.getState().pos).toEqual({ cue: -1, block: 0 })
})

function depsWith(saved: RunDeps['saved'], now: () => number): RunDeps {
  return {
    getPlan: () => buildRunPlan([], media),
    getDecks: () => decks,
    currentSlide: () => null,
    showSlide: () => {},
    playCue: () => Promise.resolve(true),
    now,
    saved,
  }
}

test('a broken saved run is ignored, never a crash', () => {
  const good = {
    workshopId: 'w1',
    pos: { cue: 2, block: 1 },
    clock: { running: false, startedAt: 0, accumulated: 5000 },
    blockStartMs: 100,
    blockStarts: { a: 0, b: 100, c: 'x', ['__proto__']: 5 },
    timer: null,
  }
  expect(parseSavedRun(good, 'w1')?.blockStarts).toEqual({ a: 0, b: 100 })
  for (const bad of [
    null,
    'text',
    [],
    { ...good, workshopId: 'w2' },
    { ...good, pos: { cue: 1.5, block: 0 } },
    { ...good, clock: { running: 'yes', startedAt: 0, accumulated: 0 } },
    { ...good, clock: { running: true, startedAt: Number.NaN, accumulated: 0 } },
    { ...good, blockStartMs: -1 },
    { ...good, timer: { seconds: 1e12, startedAt: 0 } },
  ]) {
    expect(parseSavedRun(bad, 'w1')).toBeNull()
  }
  const throwing = setup([block('a', '[SLIDE 1]')], {
    saved: {
      load: () => {
        throw new Error('blocked')
      },
      save: () => {
        throw new Error('full')
      },
    },
  })
  throwing.store.getState().syncWorkshop('w9')
  expect(() => throwing.store.getState().go()).not.toThrow()
  expect(throwing.store.getState().pos.cue).toBe(0)
})

test('a sound engine that throws does not stop GO', () => {
  const t = setup([block('a', '[SFX applause] [SLIDE 1]')], {
    playCue: () => {
      throw new Error('no audio')
    },
  })
  t.store.getState().go()
  expect(t.store.getState().pos.cue).toBe(0)
  t.store.getState().go()
  expect(t.shown).toHaveLength(1)
})

test('looking at another workshop keeps the run of the first one', () => {
  let stored: unknown = null
  const saved = {
    load: () => stored,
    save: (runs: unknown) => {
      stored = JSON.parse(JSON.stringify(runs))
    },
  }
  const t = setup([block('a', '[SLIDE 1] [SLIDE 2]')], { saved })
  const s = () => t.store.getState()
  s().go()
  t.tick(60_000)
  s().go()
  const before = { pos: s().pos, clock: s().clock }
  s().syncWorkshop('w2')
  expect(s().pos).toEqual({ cue: -1, block: 0 })
  s().syncWorkshop('w1')
  expect(s().pos).toEqual(before.pos)
  expect(s().clock).toEqual(before.clock)
  // A reload finds both runs too.
  const again = createRunStore(depsWith(saved, t.now))
  again.getState().syncWorkshop('w1')
  expect(again.getState().pos).toEqual(before.pos)
})

test('editing a script during a run keeps the place in it', () => {
  let blocks = [block('intro', '[SLIDE 1]'), block('main', '[SLIDE 2] [SFX applause] [SLIDE 3]')]
  let plan = buildRunPlan(blocks, media)
  const t = setup(blocks, { getPlan: () => plan })
  const s = () => t.store.getState()
  s().go()
  s().go()
  s().go()
  expect(t.played).toEqual([{ type: 'sfx', name: 'applause' }])
  // A cue is added to the first block, which moves every later cue by one.
  blocks = [block('intro', '[SLIDE 1] [SLIDE 4]'), blocks[1] ?? block('x', '')]
  plan = buildRunPlan(blocks, media)
  s().syncPlan()
  expect(plan.cues[s().pos.cue]?.raw).toBe('[SFX applause]')
  s().go()
  // The applause does not play again: GO goes on to the next slide.
  expect(t.played).toHaveLength(1)
  expect(last(t.shown)).toEqual({ deckId: 'd2', index: 0 })
  // Moving the blocks keeps the running block too.
  blocks = [blocks[1] ?? block('x', ''), blocks[0] ?? block('x', '')]
  plan = buildRunPlan(blocks, media)
  s().syncPlan()
  expect(plan.blocks[s().pos.block]?.id).toBe('main')
  expect(plan.cues[s().pos.cue]?.raw).toBe('[SLIDE 3]')
})

test('GO enters a block that has no cues instead of passing over it', () => {
  const t = setup([
    block('intro', 'Hi [SLIDE 1]'),
    { ...block('break', 'Take ten minutes.'), kind: 'break' },
    block('work', '[SLIDE 2] Go.'),
  ])
  const s = () => t.store.getState()
  s().go()
  expect(s().pos.block).toBe(0)
  t.tick(5_000)
  s().go()
  expect(s().pos.block).toBe(1)
  expect(s().blockStartMs).toBe(5_000)
  expect(s().note).toMatch(/no cues/)
  expect(t.shown).toHaveLength(1)
  s().go()
  expect(s().pos.block).toBe(2)
  expect(t.shown).toHaveLength(2)
})
