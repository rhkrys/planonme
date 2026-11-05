import type { Sound } from '../db/types'
import {
  AudioEngine,
  DecodeError,
  FADE_SECONDS,
  MAX_VOICES,
  PANIC_FADE_SECONDS,
  QUICK_FADE_SECONDS,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
  type OscillatorLike,
  TEST_TONE_HZ,
  TEST_TONE_LEVEL,
  TEST_TONE_SECONDS,
} from './engine'

// A fake Web Audio context that records what the engine schedules.

type Event = ['set' | 'ramp' | 'cancel', number, number]

class FakeParam implements AudioParamLike {
  value = 1
  events: Event[] = []
  setValueAtTime(value: number, time: number) {
    this.value = value
    this.events.push(['set', value, time])
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(['ramp', value, time])
  }
  cancelScheduledValues(time: number) {
    this.events.push(['cancel', 0, time])
  }
  /** The last ramp, as [value, time]. */
  lastRamp(): [number, number] | null {
    const r = [...this.events].reverse().find((e) => e[0] === 'ramp')
    return r ? [r[1], r[2]] : null
  }
}

class FakeNode implements AudioNodeLike {
  connected: AudioNodeLike[] = []
  connect(destination: AudioNodeLike) {
    this.connected.push(destination)
    return destination
  }
  disconnect() {
    this.connected = []
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam()
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null
  loop = false
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  output: FakeGain | null = null
  start(when = 0) {
    this.startedAt = when
  }
  stop(when = 0) {
    this.stoppedAt = when
  }
  connect(destination: AudioNodeLike) {
    if (destination instanceof FakeGain) this.output = destination
    return super.connect(destination)
  }
  /** What the browser does when the sound reaches its end or its stop time. */
  end() {
    this.onended?.()
  }
}

class FakeOscillator extends FakeNode implements OscillatorLike {
  type = 'square'
  frequency = new FakeParam()
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  output: FakeGain | null = null
  start(when = 0) {
    this.startedAt = when
  }
  stop(when = 0) {
    this.stoppedAt = when
  }
  connect(destination: AudioNodeLike) {
    if (destination instanceof FakeGain) this.output = destination
    return super.connect(destination)
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 10
  state = 'running'
  destination = new FakeNode()
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  decodes = 0
  /** Decodes wait for this, so tests can control when they finish. */
  gate: Promise<void> = Promise.resolve()
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  oscillators: FakeOscillator[] = []
  createOscillator() {
    const o = new FakeOscillator()
    this.oscillators.push(o)
    return o
  }
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decodes++
    await this.gate
    const text = new TextDecoder().decode(data)
    if (text.startsWith('bad')) throw new Error('EncodingError')
    return { duration: 4, length: 4 * 8000, numberOfChannels: 1 }
  }
  async resume() {
    this.state = 'running'
  }
}

function sound(id: string, patch: Partial<Sound> = {}): Sound {
  return {
    id,
    workshopId: 'w',
    name: id,
    kind: 'sfx',
    blob: new Blob([`audio ${id}`], { type: 'audio/wav' }),
    loop: false,
    volume: 1,
    hotkey: '',
    color: '',
    ...patch,
  }
}

function setup(sounds: Sound[]) {
  const ctx = new FakeContext()
  const engine = new AudioEngine(() => ctx)
  engine.setSounds(sounds)
  return { ctx, engine }
}

/** The source that plays a sound, matched by its gain node volume target. */
function liveSources(ctx: FakeContext) {
  return ctx.sources.filter((s) => s.stoppedAt === null)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('music fades in over the fade time', async () => {
  const { ctx, engine } = setup([sound('a', { kind: 'music', volume: 0.8 })])
  expect(await engine.play('a')).toBe(true)
  const src = ctx.sources[0]
  expect(src?.startedAt).toBe(10)
  expect(src?.output?.gain.events[0]).toEqual(['set', 0, 10])
  expect(src?.output?.gain.lastRamp()).toEqual([0.8, 10 + FADE_SECONDS])
  expect(engine.getSnapshot().playing.a).toMatchObject({ kind: 'music', count: 1, duration: 4 })
})

test('starting other music crossfades and only one track keeps playing', async () => {
  const { ctx, engine } = setup([
    sound('a', { kind: 'music' }),
    sound('b', { kind: 'music', volume: 0.5 }),
  ])
  await engine.play('a')
  ctx.currentTime = 20
  await engine.play('b')
  const [a, b] = ctx.sources
  // The old track fades to silence and stops when the fade ends.
  expect(a?.output?.gain.lastRamp()).toEqual([0, 20 + FADE_SECONDS])
  expect(a?.stoppedAt).toBe(20 + FADE_SECONDS)
  // The new one fades in at the same time.
  expect(b?.startedAt).toBe(20)
  expect(b?.output?.gain.lastRamp()).toEqual([0.5, 20 + FADE_SECONDS])
  expect(engine.getSnapshot().playing.a?.stopping).toBe(true)
  expect(engine.getSnapshot().playing.b?.stopping).toBe(false)

  a?.end()
  expect(Object.keys(engine.getSnapshot().playing)).toEqual(['b'])
  expect(liveSources(ctx)).toEqual([b])
})

test('only the newest music request wins while decoding', async () => {
  const { ctx, engine } = setup([sound('a', { kind: 'music' }), sound('b', { kind: 'music' })])
  let open = () => {}
  ctx.gate = new Promise((resolve) => (open = resolve))
  const first = engine.play('a')
  const second = engine.play('b')
  expect(engine.getSnapshot().loading).toEqual(['a', 'b'])
  open()
  expect(await first).toBe(false)
  expect(await second).toBe(true)
  expect(ctx.sources).toHaveLength(1)
  expect(Object.keys(engine.getSnapshot().playing)).toEqual(['b'])
  expect(engine.getSnapshot().loading).toEqual([])
})

test('a pad click on playing music fades it out, a cue keeps it playing', async () => {
  const { ctx, engine } = setup([sound('a', { kind: 'music' })])
  await engine.play('a')
  expect(await engine.play('a')).toBe(true)
  expect(ctx.sources).toHaveLength(1)
  expect(ctx.sources[0]?.stoppedAt).toBeNull()

  ctx.currentTime = 12
  await engine.play('a', { toggle: true })
  expect(ctx.sources[0]?.stoppedAt).toBe(12 + FADE_SECONDS)
  expect(engine.getSnapshot().playing.a?.stopping).toBe(true)
})

test('sound effects overlap and start at full volume', async () => {
  const { ctx, engine } = setup([sound('x', { volume: 0.6 })])
  await engine.play('x', { toggle: true })
  await engine.play('x', { toggle: true })
  expect(ctx.sources).toHaveLength(2)
  for (const s of ctx.sources) {
    expect(s.stoppedAt).toBeNull()
    expect(s.output?.gain.events).toEqual([['set', 0.6, 10]])
  }
  expect(engine.getSnapshot().playing.x?.count).toBe(2)
  // Decoded once, then taken from the cache.
  expect(ctx.decodes).toBe(1)
})

test('sound effects do not stop the music', async () => {
  const { ctx, engine } = setup([sound('m', { kind: 'music' }), sound('x')])
  await engine.play('m')
  await engine.play('x')
  expect(liveSources(ctx)).toHaveLength(2)
})

test('a looping effect stops on the second pad click', async () => {
  const { ctx, engine } = setup([sound('rain', { loop: true })])
  await engine.play('rain', { toggle: true })
  expect(ctx.sources[0]?.loop).toBe(true)
  await engine.play('rain', { toggle: true })
  expect(ctx.sources).toHaveLength(1)
  expect(ctx.sources[0]?.stoppedAt).not.toBeNull()
})

test('too many effects at once stop the oldest', async () => {
  const { ctx, engine } = setup([sound('x')])
  for (let i = 0; i < MAX_VOICES + 1; i++) await engine.play('x')
  expect(ctx.sources[0]?.stoppedAt).not.toBeNull()
  expect(liveSources(ctx)).toHaveLength(MAX_VOICES)
})

test('stop all silences everything at once', async () => {
  const { ctx, engine } = setup([sound('m', { kind: 'music' }), sound('x'), sound('y')])
  await engine.play('m')
  await engine.play('x')
  await engine.play('y')
  ctx.currentTime = 30
  engine.stopAll()
  for (const s of ctx.sources) {
    expect(s.stoppedAt).toBe(30 + PANIC_FADE_SECONDS)
    expect(s.output?.gain.lastRamp()).toEqual([0, 30 + PANIC_FADE_SECONDS])
  }
  ctx.sources.forEach((s) => s.end())
  expect(engine.getSnapshot().playing).toEqual({})
})

test('stop all also cuts short music that is already fading out', async () => {
  const { ctx, engine } = setup([sound('m', { kind: 'music' })])
  await engine.play('m')
  engine.stopMusic()
  expect(ctx.sources[0]?.stoppedAt).toBe(10 + FADE_SECONDS)
  engine.stopAll()
  expect(ctx.sources[0]?.stoppedAt).toBe(10 + PANIC_FADE_SECONDS)
})

test('stop all keeps sounds that are still decoding from starting', async () => {
  const { ctx, engine } = setup([sound('m', { kind: 'music' }), sound('x')])
  let open = () => {}
  ctx.gate = new Promise((resolve) => (open = resolve))
  const music = engine.play('m')
  const fx = engine.play('x')
  engine.stopAll()
  open()
  expect(await music).toBe(false)
  expect(await fx).toBe(false)
  expect(ctx.sources).toHaveLength(0)
})

test('stop music leaves effects playing', async () => {
  const { ctx, engine } = setup([sound('m', { kind: 'music' }), sound('x')])
  await engine.play('m')
  await engine.play('x')
  engine.stopMusic()
  expect(ctx.sources[0]?.stoppedAt).toBe(10 + FADE_SECONDS)
  expect(ctx.sources[1]?.stoppedAt).toBeNull()
})

test('cues find sounds by name', async () => {
  const { ctx, engine } = setup([
    sound('1', { name: 'Break Loop', kind: 'music' }),
    sound('2', { name: 'Applause' }),
  ])
  expect(await engine.playCue({ type: 'music', name: 'break   loop' })).toBe(true)
  expect(await engine.playCue({ type: 'sfx', name: 'APPLAUSE' })).toBe(true)
  expect(ctx.sources).toHaveLength(2)
  // [MUSIC x] while x plays keeps it going.
  expect(await engine.playCue({ type: 'music', name: 'Break Loop' })).toBe(true)
  expect(liveSources(ctx)).toHaveLength(2)
  expect(await engine.playCue({ type: 'stopMusic' })).toBe(true)
  expect(ctx.sources[0]?.stoppedAt).not.toBeNull()
  expect(await engine.playCue({ type: 'sfx', name: 'Nope' })).toBe(false)
  expect(engine.getSnapshot().error).toBe('There is no sound named "Nope".')
})

test('a file that cannot be decoded gives a readable error and plays nothing', async () => {
  const bad = sound('bad', { name: 'Broken', blob: new Blob(['bad data'], { type: 'audio/wav' }) })
  const { ctx, engine } = setup([bad])
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await engine.play('bad')).toBe(false)
  expect(engine.getSnapshot().error).toMatch(/Could not play "Broken"/)
  expect(ctx.sources).toHaveLength(0)
  // A failed decode is not cached, so the next try decodes again.
  await engine.play('bad')
  expect(ctx.decodes).toBe(2)
  engine.clearError()
  expect(engine.getSnapshot().error).toBeNull()
  spy.mockRestore()
})

test('without Web Audio the engine reports it and does not throw', async () => {
  const engine = new AudioEngine(() => null)
  engine.setSounds([sound('x')])
  expect(await engine.play('x')).toBe(false)
  expect(engine.getSnapshot().error).toBe('This browser cannot play audio.')
  await expect(engine.probe(new Blob(['x']))).rejects.toBeInstanceOf(DecodeError)
})

test('probe checks that a file decodes', async () => {
  const { engine } = setup([])
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(engine.probe(new Blob(['fine']))).resolves.toMatchObject({ duration: 4 })
  await expect(engine.probe(new Blob(['bad']))).rejects.toThrow(/could not be read as audio/)
  spy.mockRestore()
})

test('primed buffers skip decoding', async () => {
  const { ctx, engine } = setup([])
  const s = sound('x')
  engine.prime(s, { duration: 2, length: 16000, numberOfChannels: 1 })
  engine.setSounds([s])
  await engine.play('x')
  expect(ctx.decodes).toBe(0)
  expect(engine.getSnapshot().playing.x?.duration).toBe(2)
})

test('master volume is clamped, applied and remembered', async () => {
  const { ctx, engine } = setup([sound('x')])
  await engine.play('x')
  const master = ctx.gains[0]
  expect(master?.gain.value).toBe(1)
  engine.setMasterVolume(0.25)
  expect(master?.gain.lastRamp()?.[0]).toBe(0.25)
  expect(engine.getSnapshot().master).toBe(0.25)
  engine.setMasterVolume(7)
  expect(engine.getSnapshot().master).toBe(1)
  engine.setMasterVolume(Number.NaN)
  expect(engine.getSnapshot().master).toBe(1)
  engine.setMasterVolume(0.5)
  expect(new AudioEngine(() => null).getSnapshot().master).toBe(0.5)
})

test('changed sounds update what plays, and deleted sounds stop', async () => {
  const a = sound('a', { loop: false, volume: 1 })
  const b = sound('b')
  const { ctx, engine } = setup([a, b])
  await engine.play('a')
  await engine.play('b')
  engine.setSounds([{ ...a, volume: 0.3, loop: true }])
  const [srcA, srcB] = ctx.sources
  expect(srcA?.loop).toBe(true)
  expect(srcA?.output?.gain.lastRamp()?.[0]).toBe(0.3)
  expect(srcA?.stoppedAt).toBeNull()
  expect(srcB?.stoppedAt).not.toBeNull()
  expect(await engine.play('b')).toBe(false)
})

test('a suspended context is resumed on play', async () => {
  const { ctx, engine } = setup([sound('x')])
  ctx.state = 'suspended'
  await engine.play('x')
  expect(ctx.state).toBe('running')
})

test('listeners hear about changes and the snapshot is stable between them', async () => {
  const { engine } = setup([sound('x')])
  const listener = vi.fn()
  const off = engine.subscribe(listener)
  const before = engine.getSnapshot()
  expect(engine.getSnapshot()).toBe(before)
  await engine.play('x')
  expect(listener).toHaveBeenCalled()
  expect(engine.getSnapshot()).not.toBe(before)
  off()
})

test('the test tone is a short sine beep through the master volume', async () => {
  localStorage.setItem('planonme.masterVolume', '0.5')
  const { ctx, engine } = setup([])
  expect(await engine.playTestTone()).toBe(true)
  const osc = ctx.oscillators[0]
  expect(osc?.type).toBe('sine')
  expect(osc?.frequency.events[0]).toEqual(['set', TEST_TONE_HZ, 10])
  expect(osc?.startedAt).toBe(10)
  expect(osc?.stoppedAt).toBe(10 + TEST_TONE_SECONDS)
  // It fades in and out, and goes through the master gain, which holds the master volume.
  const toneGain = osc?.output
  expect(toneGain?.gain.events[0]).toEqual(['set', 0, 10])
  expect(toneGain?.gain.events[1]).toEqual(['ramp', TEST_TONE_LEVEL, 10.02])
  expect(toneGain?.gain.lastRamp()).toEqual([0, 10 + TEST_TONE_SECONDS])
  const master = ctx.gains[0]
  expect(master?.gain.value).toBe(0.5)
  expect(toneGain?.connected).toEqual([master])
  expect(engine.getSnapshot().testTone).toBe(true)

  osc?.onended?.()
  expect(engine.getSnapshot().testTone).toBe(false)
  expect(osc?.connected).toEqual([])
})

test('a second test tone replaces the first, and stop all ends it', async () => {
  const { ctx, engine } = setup([])
  await engine.playTestTone()
  await engine.playTestTone()
  expect(ctx.oscillators).toHaveLength(2)
  // The first one fades out very quickly instead of stopping with a click.
  const first = ctx.oscillators[0]
  expect(first?.stoppedAt).toBe(10 + QUICK_FADE_SECONDS)
  expect(first?.output?.gain.lastRamp()).toEqual([0, 10 + QUICK_FADE_SECONDS])
  first?.onended?.()
  expect(first?.connected).toEqual([])
  expect(engine.getSnapshot().testTone).toBe(true)
  engine.stopAll()
  expect(engine.getSnapshot().testTone).toBe(false)
})

test('the test tone reports a problem instead of throwing', async () => {
  const none = new AudioEngine(() => null)
  expect(await none.playTestTone()).toBe(false)
  expect(none.getSnapshot().error).toBe('This browser cannot play audio.')

  const ctx = new FakeContext()
  ctx.createOscillator = () => {
    throw new Error('NotSupportedError')
  }
  const engine = new AudioEngine(() => ctx)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect(await engine.playTestTone()).toBe(false)
  expect(engine.getSnapshot().error).toBe('Could not play the test tone.')
  expect(engine.getSnapshot().testTone).toBe(false)
})

test('checkSound decodes without playing and reports bad files', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const bad = sound('bad', { blob: new Blob(['bad data'], { type: 'audio/wav' }) })
  const a = sound('a')
  const { ctx, engine } = setup([a, bad])
  expect(await engine.checkSound(a)).toBeNull()
  expect(ctx.sources).toHaveLength(0)
  expect(await engine.checkSound(bad)).toMatch(/could not be read as audio/)
  expect(engine.getSnapshot().error).toBeNull()
  // The checked sound is cached, so playing it does not decode again.
  const decodes = ctx.decodes
  await engine.play('a')
  expect(ctx.decodes).toBe(decodes)

  const none = new AudioEngine(() => null)
  expect(await none.checkSound(a)).toBe('This browser cannot play audio.')
})
