import {
  audienceCheck,
  cuesCheck,
  findCueIssues,
  LIVE_CHECKS,
  MANUAL_ITEMS,
  masterWarning,
  progress,
  slidesCheck,
  soundsCheck,
  ZOOM_ITEMS,
  type CheckResult,
  type LiveCheckId,
  type MediaInfo,
} from './checklist'

const media: MediaInfo = {
  decks: [
    { name: 'Intro', slideCount: 2 },
    { name: 'Main', slideCount: 3 },
  ],
  sounds: [
    { name: 'Applause', kind: 'sfx' },
    { name: 'Break loop', kind: 'music' },
  ],
}

const ok: CheckResult = { status: 'ok', message: '' }

function allLive(patch: Partial<Record<LiveCheckId, CheckResult>> = {}) {
  return { audience: ok, slides: ok, cues: ok, sounds: ok, ...patch }
}

test('the audience check follows the connection', () => {
  expect(audienceCheck(true).status).toBe('ok')
  expect(audienceCheck(false)).toEqual({
    status: 'fail',
    message: 'The audience window is not open. Open it, then share it in Zoom.',
  })
})

test('the slides check counts slides and warns when there are none', () => {
  expect(slidesCheck(media)).toEqual({ status: 'ok', message: '5 slides in 2 decks.' })
  expect(slidesCheck({ decks: [{ name: 'A', slideCount: 1 }], sounds: [] }).message).toBe(
    '1 slide in 1 deck.',
  )
  expect(slidesCheck({ decks: [], sounds: [] }).status).toBe('warn')
  expect(slidesCheck(null).status).toBe('fail')
})

test('cue issues use the Script view checks, with block titles and line numbers', () => {
  const blocks = [
    { id: 'a', title: 'Welcome', script: 'Hi [SLIDE 1]\n[SFX applause]\nThen [SLIDE 9]' },
    { id: 'b', title: '  ', script: '[MUSIC nope]\n\n[TIMER soon]' },
    { id: 'c', title: 'Empty', script: '' },
  ]
  const { cues, issues } = findCueIssues(blocks, media)
  expect(cues).toBe(5)
  expect(issues).toEqual([
    {
      blockId: 'a',
      blockTitle: 'Welcome',
      line: 3,
      raw: '[SLIDE 9]',
      message: 'There is no slide 9. This workshop has 5 slides.',
    },
    expect.objectContaining({ blockTitle: 'Untitled block', line: 1, raw: '[MUSIC nope]' }),
    expect.objectContaining({ blockTitle: 'Untitled block', line: 3, raw: '[TIMER soon]' }),
  ])
  expect(cuesCheck(cues, issues, media)).toEqual({
    status: 'fail',
    message: '3 cues need fixing in Script. Run mode skips them.',
  })
})

test('the cues check passes when every cue is valid', () => {
  const blocks = [{ id: 'a', title: 'A', script: '[SLIDE 5] [MUSIC break  LOOP] [STOP MUSIC]' }]
  const { cues, issues } = findCueIssues(blocks, media)
  expect(issues).toEqual([])
  expect(cuesCheck(cues, issues, media)).toEqual({ status: 'ok', message: 'All 3 cues are valid.' })
  expect(cuesCheck(0, [], media).message).toBe('The script has no cues.')
})

test('without media only malformed cues are found, and the check warns', () => {
  const blocks = [{ id: 'a', title: 'A', script: '[SLIDE 99] [TIMER x]' }]
  const { cues, issues } = findCueIssues(blocks, null)
  expect(issues.map((i) => i.raw)).toEqual(['[TIMER x]'])
  expect(cuesCheck(cues, [], null).status).toBe('warn')
})

test('stored data with a non-text script does not break the cue check', () => {
  const blocks = [{ id: 'a', title: 'A', script: 42 as unknown as string }]
  expect(findCueIssues(blocks, media)).toEqual({ cues: 0, issues: [] })
})

test('the sounds check reports loading, progress, failures and success', () => {
  const sounds = [
    { id: 's1', name: 'Applause' },
    { id: 's2', name: 'Gong' },
  ]
  expect(soundsCheck(null, {}, false).status).toBe('checking')
  expect(soundsCheck(null, {}, true).status).toBe('fail')
  expect(soundsCheck([], {}, false)).toEqual({
    status: 'ok',
    message: 'This workshop has no sounds.',
  })
  expect(soundsCheck(sounds, { s1: { ok: true } }, false)).toEqual({
    status: 'checking',
    message: 'Checking sounds... 1 of 2.',
  })
  expect(soundsCheck(sounds, { s1: { ok: true }, s2: { ok: true } }, false)).toEqual({
    status: 'ok',
    message: 'All 2 sounds play.',
  })
  // A bad sound shows at once, even while others are still being checked.
  expect(soundsCheck(sounds, { s2: { ok: false, message: 'bad' } }, false)).toEqual({
    status: 'fail',
    message: '1 sound does not play. Replace it in Sounds.',
  })
})

test('the master volume warns when silent or very low', () => {
  expect(masterWarning(0)).toMatch(/at 0/)
  expect(masterWarning(Number.NaN)).toMatch(/at 0/)
  expect(masterWarning(0.1)).toMatch(/very low/)
  expect(masterWarning(0.8)).toBeNull()
})

test('the Zoom steps say what to click, in order', () => {
  expect(ZOOM_ITEMS.map((i) => i.label)).toEqual([
    'Click Share screen in Zoom',
    'Pick the "PlanOnMe Audience" window',
    'Tick "Share sound"',
    'Tick "Optimize for video clip" (optional)',
  ])
  expect(ZOOM_ITEMS[1]?.help).toMatch(/not the whole desktop/)
  expect(ZOOM_ITEMS[3]?.optional).toBe(true)
  for (const item of MANUAL_ITEMS)
    expect(item.label + item.help).not.toContain(String.fromCharCode(0x2014))
})

test('progress counts ok live checks and required ticks, not optional ones', () => {
  const required = MANUAL_ITEMS.filter((i) => !i.optional).map((i) => i.id)
  const total = LIVE_CHECKS.length + required.length
  expect(progress(allLive(), [])).toEqual({ done: 4, total, ready: false })
  expect(progress(allLive(), ['zoom-video'])).toEqual({ done: 4, total, ready: false })
  expect(progress(allLive(), required)).toEqual({ done: total, total, ready: true })
  const warn: CheckResult = { status: 'warn', message: '' }
  expect(progress(allLive({ slides: warn }), required)).toEqual({
    done: total - 1,
    total,
    ready: false,
  })
})
