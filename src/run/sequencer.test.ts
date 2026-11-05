import type { MediaNames } from '../cues/describe'
import {
  back,
  buildRunPlan,
  clampPosition,
  currentCue,
  go,
  jumpToBlock,
  jumpToCue,
  nextCue,
  nextSlideCue,
  slideAt,
  START,
  type BlockInput,
  type Position,
  type RunPlan,
} from './sequencer'

const media: MediaNames = {
  decks: [
    { name: 'Intro', slideCount: 2 },
    { name: 'Main', slideCount: 2 },
  ],
  sounds: [
    { name: 'Applause', kind: 'sfx' },
    { name: 'Break loop', kind: 'music' },
  ],
}

function block(id: string, script: string, durationMin = 10): BlockInput {
  return { id, title: id, kind: 'talk', durationMin, script }
}

function raws(plan: RunPlan, positions: Position[]): (string | null)[] {
  return positions.map((p) => plan.cues[p.cue]?.raw ?? null)
}

/** Presses GO until the end and returns each fired token. */
function runAll(plan: RunPlan): string[] {
  const out: string[] = []
  let pos = START
  for (let i = 0; i < 100; i++) {
    const r = go(plan, pos)
    if (!r.fired && r.entered === null) break
    if (r.fired) out.push(r.fired.raw)
    pos = r.pos
  }
  return out
}

describe('buildRunPlan', () => {
  test('lists every cue of every block in order, with block indexes', () => {
    const plan = buildRunPlan(
      [block('a', 'Hi [SLIDE 1] and [SFX applause]'), block('b', ''), block('c', '[TIMER 5m]')],
      media,
    )
    expect(plan.cues.map((c) => [c.raw, c.blockIndex, c.problem])).toEqual([
      ['[SLIDE 1]', 0, null],
      ['[SFX applause]', 0, null],
      ['[TIMER 5m]', 2, null],
    ])
    expect(plan.blocks.map((b) => [b.firstCue, b.cueCount])).toEqual([
      [0, 2],
      [2, 0],
      [2, 1],
    ])
    expect(plan.cues.map((c) => c.index)).toEqual([0, 1, 2])
  })

  test('marks unknown slides, unknown sounds and broken tokens with a problem', () => {
    const plan = buildRunPlan(
      [block('a', '[SLIDE 9] [SFX gong] [TIMER soon] [MUSIC break   loop] [STOP MUSIC]')],
      media,
    )
    expect(plan.cues.map((c) => c.problem)).toEqual([
      'There is no slide 9. This workshop has 4 slides.',
      'There is no sound named "gong".',
      'Use a time such as 5m, 30s or 1m30s.',
      null,
      null,
    ])
    expect(plan.cues[2]?.cue).toBeNull()
  })

  test('without media, slide and sound cues can not fire but timers can', () => {
    const plan = buildRunPlan([block('a', '[SLIDE 1] [SFX x] [STOP MUSIC] [TIMER 1m]')], null)
    expect(plan.cues.map((c) => c.problem === null)).toEqual([false, false, true, true])
  })

  test('survives bad stored data', () => {
    const bad = { id: 'x', title: 'x', kind: 'talk', durationMin: 5, script: 42 }
    const plan = buildRunPlan([bad as unknown as BlockInput], media)
    expect(plan.cues).toEqual([])
    expect(plan.blocks[0]?.script).toBe('')
  })
})

describe('go', () => {
  test('fires each cue in order and stops at the end', () => {
    const plan = buildRunPlan(
      [block('a', '[SLIDE 1] text [SFX applause]'), block('b', '[SLIDE 2] [TIMER 30s]')],
      media,
    )
    expect(runAll(plan)).toEqual(['[SLIDE 1]', '[SFX applause]', '[SLIDE 2]', '[TIMER 30s]'])
    const end = go(plan, { cue: 3, block: 1 })
    expect(end.fired).toBeNull()
    expect(end.pos).toEqual({ cue: 3, block: 1 })
  })

  test('moves the running block along with the fired cue', () => {
    const plan = buildRunPlan(
      [block('a', '[SLIDE 1]'), block('b', ''), block('c', '[SLIDE 2]')],
      media,
    )
    const first = go(plan, START)
    expect(first.pos).toEqual({ cue: 0, block: 0 })
    // Block b has no cues. GO moves into it instead of passing over it.
    const second = go(plan, first.pos)
    expect(second).toMatchObject({ pos: { cue: 0, block: 1 }, fired: null, entered: 1 })
    const third = go(plan, second.pos)
    expect(third.pos).toEqual({ cue: 1, block: 2 })
    expect(third.fired?.raw).toBe('[SLIDE 2]')
  })

  test('enters a block whose only cues can not fire, and blocks at the end', () => {
    const plan = buildRunPlan(
      [block('a', '[SLIDE 1]'), block('b', '[SFX gong]'), block('c', 'Thanks.')],
      media,
    )
    const second = go(plan, go(plan, START).pos)
    expect(second).toMatchObject({ pos: { cue: 1, block: 1 }, entered: 1 })
    expect(second.skipped.map((c) => c.raw)).toEqual(['[SFX gong]'])
    const third = go(plan, second.pos)
    expect(third).toMatchObject({ pos: { cue: 1, block: 2 }, entered: 2, skipped: [] })
    expect(go(plan, third.pos)).toMatchObject({ fired: null, entered: null })
  })

  test('skips cues that can not fire and reports them', () => {
    const plan = buildRunPlan([block('a', '[SLIDE 1] [SFX gong] [TIMER 5x] [SLIDE 2]')], media)
    const first = go(plan, START)
    const second = go(plan, first.pos)
    expect(second.fired?.raw).toBe('[SLIDE 2]')
    expect(second.skipped.map((c) => c.raw)).toEqual(['[SFX gong]', '[TIMER 5x]'])
    expect(runAll(plan)).toEqual(['[SLIDE 1]', '[SLIDE 2]'])
  })

  test('reports skipped cues at the end without moving', () => {
    const plan = buildRunPlan([block('a', '[SLIDE 1] [SFX gong]')], media)
    const first = go(plan, START)
    const end = go(plan, first.pos)
    expect(end.fired).toBeNull()
    expect(end.skipped.map((c) => c.raw)).toEqual(['[SFX gong]'])
    expect(end.pos).toEqual(first.pos)
  })

  test('does nothing in a script without cues', () => {
    const plan = buildRunPlan([block('a', 'Just words.')], media)
    expect(go(plan, START)).toEqual({ pos: START, fired: null, skipped: [], entered: null })
    expect(buildRunPlan([], media).cues).toEqual([])
    expect(go(buildRunPlan([], media), START).fired).toBeNull()
  })

  test('copes with a position past the end after the script got shorter', () => {
    const plan = buildRunPlan([block('a', '[SLIDE 1]')], media)
    const r = go(plan, { cue: 40, block: 7 })
    expect(r.fired).toBeNull()
    expect(r.pos).toEqual({ cue: 0, block: 0 })
  })
})

describe('back', () => {
  const plan = buildRunPlan(
    [block('a', '[SLIDE 1] [SFX gong] [SLIDE 2]'), block('b', ''), block('c', '[SLIDE 3]')],
    media,
  )

  test('steps back one fireable cue at a time and stops at the start', () => {
    const steps: Position[] = []
    let pos: Position = { cue: 3, block: 2 }
    for (let i = 0; i < 4; i++) {
      pos = back(plan, pos)
      steps.push(pos)
    }
    expect(raws(plan, steps)).toEqual(['[SLIDE 2]', '[SLIDE 1]', null, null])
    expect(steps[1]).toEqual({ cue: 0, block: 0 })
    expect(steps[2]).toEqual({ cue: -1, block: 0 })
    expect(steps[3]).toEqual({ cue: -1, block: 0 })
  })

  test('from the start of a block goes back to the cue before it', () => {
    const start = jumpToBlock(plan, 2)
    expect(start).toEqual({ cue: 2, block: 2 })
    expect(currentCue(plan, start)).toBeNull()
    expect(back(plan, start)).toEqual({ cue: 2, block: 0 })
  })

  test('from the start of an empty first part goes to the previous block', () => {
    const p = buildRunPlan([block('a', ''), block('b', 'no cues'), block('c', '[SLIDE 1]')], media)
    expect(back(p, jumpToBlock(p, 2))).toEqual({ cue: -1, block: 1 })
    expect(back(p, { cue: -1, block: 1 })).toEqual({ cue: -1, block: 0 })
  })

  test('back then go fires the same cue again', () => {
    const one = back(plan, { cue: 2, block: 0 })
    expect(go(plan, one).fired?.raw).toBe('[SLIDE 2]')
  })
})

describe('jumps', () => {
  const plan = buildRunPlan(
    [block('a', '[SLIDE 1] [SFX gong]'), block('b', '[SLIDE 2] [SLIDE 3]')],
    media,
  )

  test('jumpToCue makes a cue current, and GO fires the one after it', () => {
    const pos = jumpToCue(plan, 2)
    expect(pos).toEqual({ cue: 2, block: 1 })
    expect(go(plan, pos ?? START).fired?.raw).toBe('[SLIDE 3]')
  })

  test('jumpToCue refuses cues that can not fire and unknown indexes', () => {
    expect(jumpToCue(plan, 1)).toBeNull()
    expect(jumpToCue(plan, 99)).toBeNull()
    expect(jumpToCue(plan, -1)).toBeNull()
  })

  test('jumpToBlock makes GO fire the first cue of that block', () => {
    const pos = jumpToBlock(plan, 1)
    expect(pos.block).toBe(1)
    expect(go(plan, pos).fired?.raw).toBe('[SLIDE 2]')
    expect(jumpToBlock(plan, 9)).toEqual(START)
  })
})

describe('previews and slides', () => {
  const plan = buildRunPlan(
    [block('a', '[SLIDE 2] [SFX applause] [SFX gong] [SLIDE 4]'), block('b', '[TIMER 1m]')],
    media,
  )

  test('nextCue and nextSlideCue look past cues that can not fire', () => {
    expect(nextCue(plan, START)?.raw).toBe('[SLIDE 2]')
    expect(nextCue(plan, { cue: 1, block: 0 })?.raw).toBe('[SLIDE 4]')
    expect(nextSlideCue(plan, { cue: 0, block: 0 })?.raw).toBe('[SLIDE 4]')
    expect(nextSlideCue(plan, { cue: 3, block: 0 })).toBeNull()
    expect(nextCue(plan, { cue: 4, block: 1 })).toBeNull()
  })

  test('slideAt finds the slide shown at a position', () => {
    expect(slideAt(plan, START)).toBeNull()
    expect(slideAt(plan, { cue: 1, block: 0 })).toBe(2)
    expect(slideAt(plan, { cue: 4, block: 1 })).toBe(4)
  })

  test('clampPosition keeps positions inside the plan', () => {
    expect(clampPosition(plan, { cue: 50, block: 50 })).toEqual({ cue: 4, block: 1 })
    expect(clampPosition(plan, { cue: -5, block: -1 })).toEqual({ cue: -1, block: 0 })
    expect(clampPosition(plan, { cue: Number.NaN, block: 0.5 })).toEqual(START)
  })
})
