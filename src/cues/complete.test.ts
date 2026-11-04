import { LIMITS } from '../db/limits'
import { parseScript } from './parse'
import {
  applyOption,
  buildOptions,
  filterOptions,
  findCompletionQuery,
  MAX_OPTIONS,
  type CompletionMedia,
} from './complete'

const media: CompletionMedia = {
  decks: [
    { name: 'Intro', slideCount: 2 },
    { name: 'Main', slideCount: 11 },
  ],
  sounds: [
    { name: 'Applause', kind: 'sfx' },
    { name: 'Break loop', kind: 'music' },
    { name: 'bad ] name', kind: 'sfx' },
  ],
}

function labels(query: string) {
  return filterOptions(buildOptions(media), query).map((o) => o.label)
}

test('finds what is typed after an open bracket', () => {
  expect(findCompletionQuery('Hi [', 4)).toEqual({ start: 3, query: '' })
  expect(findCompletionQuery('Hi [SFX ap', 10)).toEqual({ start: 3, query: 'SFX ap' })
  expect(findCompletionQuery('Hi [SFX] x', 10)).toBeNull()
  expect(findCompletionQuery('[a\nb', 4)).toBeNull()
  expect(findCompletionQuery('no bracket', 5)).toBeNull()
  expect(findCompletionQuery('', 0)).toBeNull()
  expect(findCompletionQuery('[x', 99)).toBeNull()
  expect(findCompletionQuery(`[${'a'.repeat(500)}`, 501)).toBeNull()
})

test('lists cue types, slides across decks and sounds', () => {
  const all = buildOptions(media)
  const names = all.map((o) => o.label)
  expect(names.slice(0, 5)).toEqual(['SLIDE', 'SFX', 'MUSIC', 'STOP MUSIC', 'TIMER'])
  expect(names).toContain('SLIDE 13')
  expect(names).not.toContain('SLIDE 14')
  expect(all.find((o) => o.label === 'SLIDE 3')?.detail).toBe('Main, slide 1')
  expect(names).toContain('SFX Applause')
  expect(names).toContain('MUSIC Break loop')
  // A name with a bracket can not be written as a cue, so it is left out.
  expect(names.some((n) => n.includes('bad'))).toBe(false)
})

test('filters by what is typed', () => {
  expect(labels('')).toHaveLength(Math.min(MAX_OPTIONS, buildOptions(media).length))
  expect(labels('st')).toEqual(['STOP MUSIC'])
  expect(labels('slide 1')).toEqual(['SLIDE 1', 'SLIDE 10', 'SLIDE 11', 'SLIDE 12', 'SLIDE 13'])
  expect(labels('SLIDE ')).not.toContain('SLIDE')
  expect(labels('app')).toEqual(['SFX Applause'])
  expect(labels('music b')).toEqual(['MUSIC Break loop'])
  expect(labels('timer 5')).toEqual(['TIMER 5m'])
  expect(labels('zzz')).toEqual([])
})

test('caps the number of options', () => {
  const big: CompletionMedia = { decks: [{ name: 'D', slideCount: 3000 }], sounds: [] }
  expect(filterOptions(buildOptions(big), '')).toHaveLength(MAX_OPTIONS)
  expect(buildOptions(big).length).toBeLessThanOrEqual(2000 + 20)
})

test('inserts an option and reports whether the cue is done', () => {
  const opts = buildOptions(media)
  const stop = opts.find((o) => o.label === 'STOP MUSIC')
  const slide = opts.find((o) => o.label === 'SLIDE')
  if (!stop || !slide) throw new Error('missing options')

  const text = 'Go [st now'
  const q = findCompletionQuery(text, 6)
  if (!q) throw new Error('no query')
  expect(applyOption(text, q, 6, stop)).toEqual({
    text: 'Go [STOP MUSIC] now',
    caret: 15,
    done: true,
  })
  expect(applyOption('[', { start: 0, query: '' }, 1, slide)).toEqual({
    text: '[SLIDE ',
    caret: 7,
    done: false,
  })
  // An existing closing bracket is reused.
  expect(applyOption('[st]', { start: 0, query: 'st' }, 3, stop)).toEqual({
    text: '[STOP MUSIC]',
    caret: 12,
    done: true,
  })
})

test('every offered sound fits in a cue token', () => {
  const name = 'n'.repeat(LIMITS.maxTitleLength)
  const options = buildOptions({ decks: [], sounds: [{ name, kind: 'music' }] })
  const option = options.find((o) => o.id === 'sound-0')
  expect(option?.insert).toBe(`MUSIC ${name}]`)
  expect(parseScript(`[${option?.insert ?? ''}`).cues).toHaveLength(1)
})
