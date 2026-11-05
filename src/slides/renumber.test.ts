import { parseScript } from '../cues/parse'
import { renumberSlideCues, slideNumberMap } from './renumber'

const a = { id: 'a', slideCount: 3 }
const b = { id: 'b', slideCount: 2 }

test('moving a deck keeps every cue on its slide', () => {
  const map = slideNumberMap([a, b], [b, a])
  expect([1, 2, 3, 4, 5, 6].map(map)).toEqual([3, 4, 5, 1, 2, undefined])
  const result = renumberSlideCues('Hi [SLIDE 4] then [slide 1] and [SLIDE 9].', map)
  expect(result).toEqual({ script: 'Hi [SLIDE 1] then [SLIDE 3] and [SLIDE 9].', changed: 2 })
})

test('deleting a deck marks its cues and moves the later ones', () => {
  const map = slideNumberMap([a, b], [b])
  const result = renumberSlideCues('[SLIDE 2] [SLIDE 5] [SFX x]', map)
  expect(result).toEqual({ script: '[SLIDE ?] [SLIDE 2] [SFX x]', changed: 2 })
  // The marked cue shows up as a problem, so it is fixed before the session.
  expect(parseScript(result.script).invalid[0]?.message).toMatch(/deleted deck/)
})

test('leaves a script without changes alone', () => {
  const script = 'No cues here.'
  expect(renumberSlideCues(script, slideNumberMap([a, b], [a, b]))).toEqual({ script, changed: 0 })
})
