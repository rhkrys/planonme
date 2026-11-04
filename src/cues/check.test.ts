import { checkScript, findSound, lineOf, type CueContext } from './check'
import { parseScript } from './parse'

const context: CueContext = {
  slideCount: 5,
  sounds: [
    { name: 'Applause', kind: 'sfx' },
    { name: 'Break  Loop', kind: 'music' },
  ],
}

function messages(text: string, ctx: CueContext | null = context) {
  return checkScript(parseScript(text), ctx).map((p) => p.message)
}

test('accepts good cues', () => {
  expect(
    messages('[SLIDE 1] [SLIDE 5] [SFX applause] [MUSIC break loop] [STOP MUSIC] [TIMER 5m]'),
  ).toEqual([])
})

test('sound names match without case', () => {
  expect(messages('[SFX APPLAUSE] [sfx Applause] [MUSIC BREAK LOOP]')).toEqual([])
  expect(findSound(context.sounds, ' break   loop ')?.name).toBe('Break  Loop')
  expect(findSound(context.sounds, 'nope')).toBeNull()
})

test('flags unknown sounds and slides out of range', () => {
  expect(messages('[SFX boo] [SLIDE 6] [MUSIC Applause]')).toEqual([
    'There is no sound named "boo".',
    'There is no slide 6. This workshop has 5 slides.',
  ])
  expect(messages('[SLIDE 2]', { slideCount: 1, sounds: [] })).toEqual([
    'There is no slide 2. This workshop has 1 slide.',
  ])
  expect(messages('[SLIDE 1]', { slideCount: 0, sounds: [] })).toEqual([
    'There are no slides yet. Add them in Slides.',
  ])
})

test('flags bad timers and other malformed cues in text order', () => {
  const text = 'a [TIMER 5x]\nb [SLIDE 0]\n[SFX nope]'
  const problems = checkScript(parseScript(text), context)
  expect(problems.map((p) => [p.raw, lineOf(text, p.start)])).toEqual([
    ['[TIMER 5x]', 1],
    ['[SLIDE 0]', 2],
    ['[SFX nope]', 3],
  ])
})

test('without a context only malformed cues are flagged', () => {
  expect(messages('[SLIDE 99] [SFX boo] [TIMER x]', null)).toEqual([
    'Use a time such as 5m, 30s or 1m30s.',
  ])
})

test('lineOf counts lines from 1', () => {
  expect(lineOf('', 0)).toBe(1)
  expect(lineOf('a\nb\nc', 4)).toBe(3)
  expect(lineOf('a\nb', 99)).toBe(2)
})
