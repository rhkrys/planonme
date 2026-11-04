import {
  formatCue,
  formatTimer,
  MAX_TOKEN_LENGTH,
  parseScript,
  parseTimer,
  type Segment,
} from './parse'

function kinds(segments: Segment[]) {
  return segments.map((s) => (s.kind === 'text' ? `text:${s.text}` : `${s.kind}:${s.raw}`))
}

test('splits text and cues with positions', () => {
  const text = 'Hello [SLIDE 4] then [SFX applause] and [STOP MUSIC].'
  const { segments, cues, invalid } = parseScript(text)
  expect(kinds(segments)).toEqual([
    'text:Hello ',
    'cue:[SLIDE 4]',
    'text: then ',
    'cue:[SFX applause]',
    'text: and ',
    'cue:[STOP MUSIC]',
    'text:.',
  ])
  expect(invalid).toEqual([])
  expect(cues.map((c) => c.cue)).toEqual([
    { type: 'slide', slide: 4 },
    { type: 'sfx', name: 'applause' },
    { type: 'stopMusic' },
  ])
  for (const seg of segments)
    expect(text.slice(seg.start, seg.end)).toBe(seg.kind === 'text' ? seg.text : seg.raw)
  // Segments cover the whole text without gaps.
  expect(segments[0]?.start).toBe(0)
  expect(segments[segments.length - 1]?.end).toBe(text.length)
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i]?.start).toBe(segments[i - 1]?.end)
  }
})

test('reads every cue type', () => {
  const { cues } = parseScript(
    '[SLIDE 1][SFX ding][MUSIC break loop][STOP MUSIC][TIMER 5m][TIMER 30s][TIMER 1m30s]',
  )
  expect(cues.map((c) => c.cue)).toEqual([
    { type: 'slide', slide: 1 },
    { type: 'sfx', name: 'ding' },
    { type: 'music', name: 'break loop' },
    { type: 'stopMusic' },
    { type: 'timer', seconds: 300 },
    { type: 'timer', seconds: 30 },
    { type: 'timer', seconds: 90 },
  ])
})

test('keywords ignore case and extra spaces', () => {
  const { cues } = parseScript('[slide 2] [ Sfx   big   bang ] [stop   music] [timer 2M]')
  expect(cues.map((c) => c.cue)).toEqual([
    { type: 'slide', slide: 2 },
    { type: 'sfx', name: 'big bang' },
    { type: 'stopMusic' },
    { type: 'timer', seconds: 120 },
  ])
})

test('text in brackets that is not a cue stays text', () => {
  for (const text of [
    '[note to self]',
    '[]',
    '[ ]',
    '[SLIDE3]',
    '[STOP]',
    '[STOP NOW]',
    '[STOP MUSICS]',
    '[123]',
    '[-SLIDE 1]',
  ]) {
    const { segments, cues, invalid } = parseScript(text)
    expect(cues).toEqual([])
    expect(invalid).toEqual([])
    expect(kinds(segments)).toEqual([`text:${text}`])
  }
})

test('unclosed, nested and multi line brackets are text', () => {
  expect(kinds(parseScript('[SLIDE 1').segments)).toEqual(['text:[SLIDE 1'])
  expect(kinds(parseScript('a [SLIDE\n1] b').segments)).toEqual(['text:a [SLIDE\n1] b'])
  expect(kinds(parseScript('[[SLIDE 2]]').segments)).toEqual(['text:[', 'cue:[SLIDE 2]', 'text:]'])
  expect(kinds(parseScript(']]][SFX x').segments)).toEqual(['text:]]][SFX x'])
})

test('a known keyword with a bad argument is flagged, not a cue', () => {
  const cases: [string, string][] = [
    ['[SLIDE]', 'Add a slide number.'],
    ['[SLIDE two]', 'Slide number must be a number.'],
    ['[SLIDE 1.5]', 'Slide number must be a number.'],
    ['[SLIDE -1]', 'Slide number must be a number.'],
    ['[SLIDE 0]', 'Slides start at 1.'],
    ['[SLIDE 999999999]', 'Slide number is too big.'],
    ['[SFX]', 'Add a sound name.'],
    ['[MUSIC   ]', 'Add a sound name.'],
    ['[STOP MUSIC now]', 'Stop music takes no name.'],
    ['[TIMER]', 'Add a time, such as 5m or 30s.'],
    ['[TIMER soon]', 'Use a time such as 5m, 30s or 1m30s.'],
    ['[TIMER 5]', 'Use a time such as 5m, 30s or 1m30s.'],
    ['[TIMER 5x]', 'Use a time such as 5m, 30s or 1m30s.'],
    ['[TIMER 30s5m]', 'Use a time such as 5m, 30s or 1m30s.'],
    ['[TIMER 0m]', 'Timer must be longer than 0s.'],
    ['[TIMER 25h]', 'Timer can be at most 24h.'],
  ]
  for (const [text, message] of cases) {
    const { cues, invalid, segments } = parseScript(`x ${text} y`)
    expect(cues).toEqual([])
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatchObject({ raw: text, message, start: 2, end: 2 + text.length })
    expect(segments).toHaveLength(3)
  }
})

test('very long bracket text is not a cue', () => {
  const name = 'a'.repeat(MAX_TOKEN_LENGTH + 5)
  expect(parseScript(`[SFX ${name}]`).cues).toEqual([])
  const ok = 'a'.repeat(MAX_TOKEN_LENGTH - 4)
  expect(parseScript(`[SFX ${ok}]`).cues).toHaveLength(1)
})

test('never throws on odd input', () => {
  expect(parseScript(undefined).segments).toEqual([])
  expect(parseScript(42).segments).toEqual([])
  expect(parseScript('').segments).toEqual([])
  const junk = '[[[]]]][SLIDE [TIMER \u0000 \uD800 [SFX \u{1F600}] '.repeat(200)
  const parsed = parseScript(junk)
  expect(parsed.segments.map((s) => (s.kind === 'text' ? s.text : s.raw)).join('')).toBe(junk)
  expect(parsed.cues[0]?.cue).toEqual({ type: 'sfx', name: '\u{1F600}' })
})

test('handles a long script quickly', () => {
  const text = 'Say hello [SLIDE 1] and [TIMER 1m] then [ wait\n'.repeat(5000)
  const started = performance.now()
  const parsed = parseScript(text)
  expect(performance.now() - started).toBeLessThan(1000)
  expect(parsed.cues).toHaveLength(10000)
})

test('parses and formats timers', () => {
  expect(parseTimer('5m')).toBe(300)
  expect(parseTimer('30s')).toBe(30)
  expect(parseTimer('1m30s')).toBe(90)
  expect(parseTimer('1m 30s')).toBe(90)
  expect(parseTimer('1h')).toBe(3600)
  expect(parseTimer('90s')).toBe(90)
  expect(parseTimer('')).toBeNull()
  expect(parseTimer('m')).toBeNull()
  expect(parseTimer('1.5m')).toBeNull()
  expect(formatTimer(90)).toBe('1m30s')
  expect(formatTimer(300)).toBe('5m')
  expect(formatTimer(3600 + 5)).toBe('1h5s')
  expect(formatTimer(0)).toBe('0s')
})

test('formats cues back to tokens that parse the same', () => {
  const text = '[SLIDE 7][SFX big bang][MUSIC intro][STOP MUSIC][TIMER 1m30s]'
  const { cues } = parseScript(text)
  expect(cues.map((c) => formatCue(c.cue)).join('')).toBe(text)
})
