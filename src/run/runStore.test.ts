import type { SlidePos } from '../slides/decks'
import { last } from '../test/fakeChannel'
import { createRunStore, skippedNote, type RunDeps } from './runStore'
import { buildRunPlan, type BlockInput } from './sequencer'

const decks = [
  { id: 'd1', name: 'Intro', slideCount: 2 },
  { id: 'd2', name: 'Main', slideCount: 2 },
]
const media = { decks, sounds: [{ name: 'Applause', kind: 'sfx' as const }] }

function block(id: string, script: string, durationMin = 10): BlockInput {
  return { id, title: id, kind: 'talk', durationMin, script }
}

function setup(blocks: BlockInput[]) {
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
