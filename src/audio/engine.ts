// The sound engine: plays a workshop's sounds through Web Audio.
//
// - Decoded audio is cached per sound, so a pad starts at once the second time.
// - Music fades in and out, and only one music track plays at a time. Starting another one
//   crossfades from the old track to the new one.
// - Sound effects start at once and can overlap.
// - Each sound has its own volume, and everything goes through one master volume.
// - stopAll() is the panic button: it silences everything within a few milliseconds.
//
// Run mode (step 8) fires script cues with playCue(), or playByName() and stopMusic().

import { findSound } from '../cues/check'
import type { Sound, SoundKind } from '../db/types'

/** Seconds a music track takes to fade in or out. */
export const FADE_SECONDS = 1.5
/** Seconds for the panic stop. Short, but long enough to avoid a click. */
export const PANIC_FADE_SECONDS = 0.03
/** Seconds for a sound effect stop, and for volume changes while playing. */
export const QUICK_FADE_SECONDS = 0.08
/** Most sounds playing at once. The oldest sound effect stops to make room. */
export const MAX_VOICES = 32
/** Roughly how much decoded audio (in bytes) to keep cached. */
export const MAX_CACHE_BYTES = 512 * 1024 * 1024
/**
 * Longest sound that is decoded, in seconds. Decoded audio takes far more memory than the file:
 * a 100 MB MP3 can be close to two hours long and needs gigabytes once decoded, which can crash
 * the tab. 15 minutes of stereo audio is about 350 MB decoded.
 */
export const MAX_SOUND_SECONDS = 15 * 60
/** Most decoded audio for one sound, in bytes. A safety net when the length is not known. */
export const MAX_DECODED_BYTES = MAX_SOUND_SECONDS * 48_000 * 2 * 4
/** Message for a sound that is too long. */
export const TOO_LONG_MESSAGE = `This sound is longer than ${MAX_SOUND_SECONDS / 60} minutes. Use a shorter file, or loop a shorter part.`
/** Pitch of the pre-flight test tone, in hertz. */
export const TEST_TONE_HZ = 440
/** Seconds the test tone lasts. */
export const TEST_TONE_SECONDS = 0.8
/** Loudness of the test tone before the master volume, from 0 to 1. */
export const TEST_TONE_LEVEL = 0.4

// The parts of Web Audio the engine uses. Tests pass a fake context with the same shape.
export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}
export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}
export interface AudioBufferLike {
  duration: number
  length: number
  numberOfChannels: number
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}
export interface OscillatorLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: AudioNodeLike
  createGain(): GainNodeLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
  resume(): Promise<void>
}

/** What a pad needs to show while its sound plays. Times are in the engine clock (now()). */
export interface PlayingInfo {
  soundId: string
  kind: SoundKind
  /** How many copies play (sound effects can overlap). */
  count: number
  /** Start of the newest copy. */
  startedAt: number
  duration: number
  loop: boolean
  /** True when every copy is fading out. */
  stopping: boolean
}

export interface EngineSnapshot {
  /** Playing sounds by sound id. */
  playing: Readonly<Record<string, PlayingInfo>>
  /** Ids of sounds being decoded before they can start. */
  loading: readonly string[]
  /** Master volume from 0 to 1. */
  master: number
  /** The last playback problem, readable for the user, or null. */
  error: string | null
  /** True while the pre-flight test tone plays. */
  testTone: boolean
}

export type EngineCue = { type: 'sfx' | 'music'; name: string } | { type: 'stopMusic' }

export interface PlayOptions {
  /**
   * Pad behaviour: a playing music track, or a playing looped sound effect, stops instead of
   * starting again. Cues leave this off, so [MUSIC x] keeps x playing.
   */
  toggle?: boolean
  /**
   * Play as music or as an effect, whatever the stored kind. Cues set this from their keyword,
   * so [MUSIC x] fades and crossfades and [STOP MUSIC] stops it.
   */
  as?: SoundKind
}

/**
 * Reads the length of an audio file in seconds without decoding it, or null when it cannot
 * tell. Used to refuse files that would need too much memory once decoded.
 */
export type ReadDuration = (blob: Blob) => Promise<number | null>

/** Reads the length from the file's header with an audio element. */
export function browserDuration(blob: Blob, timeoutMs = 4000): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let finished = false
    let url: string | null = null
    let audio: HTMLAudioElement | null = null
    const timer = setTimeout(() => done(null), timeoutMs)
    function done(value: number | null) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (audio) {
        audio.onloadedmetadata = null
        audio.onerror = null
        audio.removeAttribute('src')
      }
      if (url) URL.revokeObjectURL(url)
      resolve(value)
    }
    try {
      const el = document.createElement('audio')
      audio = el
      el.preload = 'metadata'
      el.onloadedmetadata = () =>
        done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null)
      el.onerror = () => done(null)
      url = URL.createObjectURL(blob)
      el.src = url
    } catch {
      done(null)
    }
  })
}

interface Voice {
  soundId: string
  kind: SoundKind
  source: BufferSourceLike
  gain: GainNodeLike
  startedAt: number
  duration: number
  loop: boolean
  volume: number
  stopping: boolean
}

interface ToneVoice {
  osc: OscillatorLike
  gain: GainNodeLike
}

interface CacheEntry {
  size: number
  type: string
  buffer: Promise<AudioBufferLike>
  bytes: number
}

const MASTER_KEY = 'planonme.masterVolume'

function clamp01(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

function readMaster(): number {
  try {
    const raw = globalThis.localStorage?.getItem(MASTER_KEY)
    return raw === null || raw === undefined ? 1 : clamp01(Number(raw), 1)
  } catch {
    return 1
  }
}

function saveMaster(value: number) {
  try {
    globalThis.localStorage?.setItem(MASTER_KEY, String(value))
  } catch {
    // Storage can be blocked. The volume then only lasts for this visit.
  }
}

/** Creates the browser's AudioContext, or returns null if there is none. */
export function browserContext(): AudioContextLike | null {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  return new Ctor() as unknown as AudioContextLike
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecodeError'
  }
}

export class AudioEngine {
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private masterVolume: number
  private sounds = new Map<string, Sound>()
  private voices: Voice[] = []
  private cache = new Map<string, CacheEntry>()
  private loading = new Map<string, number>()
  /** Goes up on every stopAll, so sounds still decoding at that moment never start. */
  private generation = 0
  /** Goes up whenever music is asked to start or stop, so only the newest request wins. */
  private musicToken = 0
  private error: string | null = null
  private tone: ToneVoice | null = null
  private listeners = new Set<() => void>()
  private snapshot: EngineSnapshot

  private readonly makeContext: () => AudioContextLike | null
  private readonly readDuration: ReadDuration

  constructor(
    makeContext: () => AudioContextLike | null = browserContext,
    readDuration: ReadDuration = browserDuration,
  ) {
    this.makeContext = makeContext
    this.readDuration = readDuration
    this.masterVolume = readMaster()
    this.snapshot = this.buildSnapshot()
  }

  // ---- State for React (useSyncExternalStore) ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EngineSnapshot => this.snapshot

  /** The engine clock in seconds, for progress bars. */
  now(): number {
    return this.ctx?.currentTime ?? 0
  }

  private emit() {
    this.snapshot = this.buildSnapshot()
    for (const l of this.listeners) l()
  }

  private buildSnapshot(): EngineSnapshot {
    const playing: Record<string, PlayingInfo> = {}
    for (const v of [...this.voices]) {
      const info = playing[v.soundId]
      if (!info) {
        playing[v.soundId] = {
          soundId: v.soundId,
          kind: v.kind,
          count: 1,
          startedAt: v.startedAt,
          duration: v.duration,
          loop: v.loop,
          stopping: v.stopping,
        }
      } else {
        info.count++
        if (v.startedAt >= info.startedAt) {
          info.startedAt = v.startedAt
          info.duration = v.duration
          info.loop = v.loop
        }
        info.stopping = info.stopping && v.stopping
      }
    }
    return {
      playing,
      loading: [...this.loading.keys()],
      master: this.masterVolume,
      error: this.error,
      testTone: this.tone !== null,
    }
  }

  // ---- Sounds ----

  /**
   * Sets the sounds that can play, usually the current workshop's. Sounds that are gone stop,
   * and volume or loop changes apply to sounds already playing.
   */
  setSounds(sounds: readonly Sound[]) {
    this.sounds = new Map(sounds.map((s) => [s.id, s]))
    for (const id of [...this.cache.keys()]) {
      const s = this.sounds.get(id)
      const entry = this.cache.get(id)
      if (!s || (entry && (entry.size !== s.blob.size || entry.type !== s.blob.type))) {
        this.cache.delete(id)
      }
    }
    const now = this.now()
    for (const v of [...this.voices]) {
      if (v.stopping) continue
      const s = this.sounds.get(v.soundId)
      if (!s) {
        this.fadeOut(v, QUICK_FADE_SECONDS)
        continue
      }
      if (s.loop !== v.loop) {
        v.loop = s.loop
        v.source.loop = s.loop
      }
      if (s.volume !== v.volume) {
        v.volume = s.volume
        this.rampTo(v.gain, s.volume, now, QUICK_FADE_SECONDS)
      }
    }
    this.emit()
  }

  /** The sound with this name (ignoring case and extra spaces), or null. */
  findByName(name: string): Sound | null {
    return findSound([...this.sounds.values()], name)
  }

  // ---- Playback ----

  /**
   * Plays a sound. Music fades in and crossfades from any other music. Resolves to true when the
   * sound started (or, with toggle, stopped), and false with snapshot.error set when it failed.
   */
  async play(soundId: string, options: PlayOptions = {}): Promise<boolean> {
    const sound = this.sounds.get(soundId)
    if (!sound) return this.fail('This sound is no longer there.')
    const ctx = this.context()
    if (!ctx) return this.fail('This browser cannot play audio.')
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)

    const kind = options.as ?? sound.kind
    const active = this.voices.filter((v) => v.soundId === soundId && !v.stopping)
    let token = this.musicToken
    if (kind === 'music') {
      if (active.length > 0) {
        if (options.toggle) {
          this.musicToken++
          for (const v of active) this.fadeOut(v, FADE_SECONDS)
          this.emit()
        }
        return true
      }
      token = ++this.musicToken
    } else if (options.toggle && sound.loop && active.length > 0) {
      for (const v of active) this.fadeOut(v, QUICK_FADE_SECONDS)
      this.emit()
      return true
    }

    const generation = this.generation
    let buffer: AudioBufferLike
    this.loading.set(soundId, (this.loading.get(soundId) ?? 0) + 1)
    this.emit()
    try {
      buffer = await this.buffer(sound)
    } catch (err) {
      console.error(err)
      if (err instanceof DecodeError)
        return this.fail(`Could not play "${sound.name}". ${err.message}`)
      return this.fail(
        `Could not play "${sound.name}". The file may be damaged, or this browser cannot play it.`,
      )
    } finally {
      const left = (this.loading.get(soundId) ?? 1) - 1
      if (left > 0) this.loading.set(soundId, left)
      else this.loading.delete(soundId)
      this.emit()
    }

    // Something newer happened while decoding: a panic stop, another music request, or the
    // sound was deleted.
    if (generation !== this.generation) return false
    if (kind === 'music' && token !== this.musicToken) return false
    const current = this.sounds.get(soundId)
    if (!current) return false

    try {
      this.start(ctx, current, buffer, kind)
    } catch (err) {
      console.error(err)
      return this.fail(`Could not play "${current.name}".`)
    }
    if (this.error) this.error = null
    this.emit()
    return true
  }

  /**
   * Plays the sound with this name, as a cue would, as music or as an effect when as is given.
   * False if there is no such sound.
   */
  async playByName(name: string, as?: SoundKind): Promise<boolean> {
    const sound = this.findByName(name)
    if (!sound) return this.fail(`There is no sound named "${name}".`)
    return this.play(sound.id, as ? { as } : {})
  }

  /** Fires a script cue: [SFX name], [MUSIC name] or [STOP MUSIC]. */
  async playCue(cue: EngineCue): Promise<boolean> {
    if (cue.type === 'stopMusic') {
      this.stopMusic()
      return true
    }
    return this.playByName(cue.name, cue.type)
  }

  /** Fades out the music. Sound effects keep playing. */
  stopMusic() {
    this.musicToken++
    for (const v of [...this.voices]) {
      if (v.kind === 'music' && !v.stopping) this.fadeOut(v, FADE_SECONDS)
    }
    this.emit()
  }

  /** Stops one sound, with a fade for music. */
  stop(soundId: string) {
    const sound = this.sounds.get(soundId)
    const musicPlays = this.voices.some((v) => v.soundId === soundId && v.kind === 'music')
    if (sound?.kind === 'music' || musicPlays) this.musicToken++
    for (const v of [...this.voices]) {
      if (v.soundId === soundId && !v.stopping) {
        this.fadeOut(v, v.kind === 'music' ? FADE_SECONDS : QUICK_FADE_SECONDS)
      }
    }
    this.emit()
  }

  /** The panic button: stops everything at once, including sounds still loading. */
  stopAll() {
    this.generation++
    this.musicToken++
    for (const v of [...this.voices]) {
      if (v.stopping) this.forceStop(v)
      else this.fadeOut(v, PANIC_FADE_SECONDS)
    }
    this.stopTone()
    this.error = null
    this.emit()
  }

  /**
   * Plays a short sine beep through the master volume, so the presenter can check that Zoom
   * shares the app's sound. Resolves to false with snapshot.error set when it could not play.
   */
  async playTestTone(): Promise<boolean> {
    const ctx = this.context()
    const master = this.master
    if (!ctx || !master) return this.fail('This browser cannot play audio.')
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)
    this.stopTone()
    let tone: ToneVoice
    try {
      const now = ctx.currentTime
      const end = now + TEST_TONE_SECONDS
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(TEST_TONE_HZ, now)
      // Short ramps at both ends, so the beep does not click.
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(TEST_TONE_LEVEL, now + 0.02)
      gain.gain.setValueAtTime(TEST_TONE_LEVEL, end - 0.05)
      gain.gain.linearRampToValueAtTime(0, end)
      osc.connect(gain)
      gain.connect(master)
      tone = { osc, gain }
      osc.onended = () => this.endTone(tone)
      osc.start(now)
      osc.stop(end)
    } catch (err) {
      console.error(err)
      return this.fail('Could not play the test tone.')
    }
    this.tone = tone
    // onended normally clears the tone. This is a safety net in case it never fires.
    setTimeout(() => this.endTone(tone), (TEST_TONE_SECONDS + 1) * 1000)
    this.error = null
    this.emit()
    return true
  }

  /**
   * Decodes a sound to check that it can play, without playing it. The decoded audio is kept in
   * the cache, so the first play is quick. Resolves to null when it works, or to a readable
   * problem. Never throws, and never sets snapshot.error.
   */
  async checkSound(sound: Sound): Promise<string | null> {
    if (!this.context()) return 'This browser cannot play audio.'
    try {
      await this.buffer(sound)
      return null
    } catch (err) {
      console.error(err)
      if (err instanceof DecodeError) return err.message
      return 'This file could not be read as audio. It may be damaged, or this browser cannot play it.'
    }
  }

  setMasterVolume(value: number) {
    const v = clamp01(value, this.masterVolume)
    this.masterVolume = v
    saveMaster(v)
    if (this.master && this.ctx) this.rampTo(this.master, v, this.ctx.currentTime, 0.02)
    this.emit()
  }

  clearError() {
    if (this.error === null) return
    this.error = null
    this.emit()
  }

  /**
   * Decodes an audio file to check that it plays, and returns its length in seconds. Throws a
   * DecodeError with a readable message when it cannot be decoded.
   */
  async probe(blob: Blob): Promise<{ duration: number; buffer: AudioBufferLike }> {
    const ctx = this.context()
    if (!ctx) throw new DecodeError('This browser cannot play audio.')
    await this.checkLength(blob)
    let buffer: AudioBufferLike
    try {
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      if (!(buffer.duration > 0)) throw new Error('empty audio')
    } catch (err) {
      console.error(err)
      throw new DecodeError('This file could not be read as audio. It may be damaged.')
    }
    if (tooBig(buffer)) throw new DecodeError(TOO_LONG_MESSAGE)
    return { duration: buffer.duration, buffer }
  }

  /** Throws a DecodeError before decoding a file that is known to be too long. */
  private async checkLength(blob: Blob): Promise<void> {
    let seconds: number | null = null
    try {
      seconds = await this.readDuration(blob)
    } catch {
      seconds = null
    }
    if (seconds !== null && seconds > MAX_SOUND_SECONDS) throw new DecodeError(TOO_LONG_MESSAGE)
  }

  /** Puts an already decoded buffer in the cache, for example right after an upload. */
  prime(sound: Pick<Sound, 'id' | 'blob'>, buffer: AudioBufferLike) {
    this.remember(sound.id, {
      size: sound.blob.size,
      type: sound.blob.type,
      buffer: Promise.resolve(buffer),
      bytes: bufferBytes(buffer),
    })
  }

  // ---- Internals ----

  private context(): AudioContextLike | null {
    if (this.ctx) return this.ctx
    let ctx: AudioContextLike | null = null
    try {
      ctx = this.makeContext()
    } catch (err) {
      console.error(err)
    }
    if (!ctx) return null
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = this.masterVolume
    master.connect(ctx.destination)
    this.master = master
    return ctx
  }

  private fail(message: string): false {
    this.error = message
    this.emit()
    return false
  }

  private async buffer(sound: Sound): Promise<AudioBufferLike> {
    const cached = this.cache.get(sound.id)
    if (cached && cached.size === sound.blob.size && cached.type === sound.blob.type) {
      // Most recently used goes last.
      this.cache.delete(sound.id)
      this.cache.set(sound.id, cached)
      return cached.buffer
    }
    const ctx = this.context()
    if (!ctx) throw new DecodeError('This browser cannot play audio.')
    const entry: CacheEntry = {
      size: sound.blob.size,
      type: sound.blob.type,
      bytes: 0,
      buffer: this.checkLength(sound.blob)
        .then(() => sound.blob.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => {
          if (tooBig(buffer)) throw new DecodeError(TOO_LONG_MESSAGE)
          return buffer
        }),
    }
    this.remember(sound.id, entry)
    try {
      const buffer = await entry.buffer
      entry.bytes = bufferBytes(buffer)
      this.trimCache(sound.id)
      return buffer
    } catch (err) {
      if (this.cache.get(sound.id) === entry) this.cache.delete(sound.id)
      throw err
    }
  }

  private remember(id: string, entry: CacheEntry) {
    this.cache.delete(id)
    this.cache.set(id, entry)
    this.trimCache(id)
  }

  /** Drops the least recently used buffers while the cache is too big. */
  private trimCache(keep: string) {
    let total = 0
    for (const e of this.cache.values()) total += e.bytes
    for (const [id, e] of this.cache) {
      if (total <= MAX_CACHE_BYTES) break
      if (id === keep) continue
      this.cache.delete(id)
      total -= e.bytes
    }
  }

  private start(ctx: AudioContextLike, sound: Sound, buffer: AudioBufferLike, kind: SoundKind) {
    const master = this.master
    if (!master) throw new Error('No master gain')
    const now = ctx.currentTime

    if (kind === 'music') {
      // Crossfade: the old track fades out while the new one fades in.
      for (const v of [...this.voices]) {
        if (v.kind === 'music' && !v.stopping) this.fadeOut(v, FADE_SECONDS)
      }
    } else {
      const live = this.voices.filter((v) => !v.stopping)
      if (live.length >= MAX_VOICES) {
        const oldest = live.find((v) => v.kind === 'sfx')
        if (oldest) this.fadeOut(oldest, QUICK_FADE_SECONDS)
      }
    }

    const gain = ctx.createGain()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = sound.loop
    const volume = clamp01(sound.volume, 1)
    if (kind === 'music') {
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(volume, now + FADE_SECONDS)
    } else {
      gain.gain.setValueAtTime(volume, now)
    }
    source.connect(gain)
    gain.connect(master)

    const voice: Voice = {
      soundId: sound.id,
      kind,
      source,
      gain,
      startedAt: now,
      duration: buffer.duration,
      loop: sound.loop,
      volume,
      stopping: false,
    }
    source.onended = () => this.remove(voice)
    this.voices.push(voice)
    source.start(now)
  }

  private rampTo(node: GainNodeLike, value: number, now: number, seconds: number) {
    const g = node.gain
    const from = g.value
    g.cancelScheduledValues(now)
    g.setValueAtTime(from, now)
    g.linearRampToValueAtTime(value, now + seconds)
  }

  private fadeOut(v: Voice, seconds: number) {
    if (v.stopping) return
    v.stopping = true
    const now = this.now()
    try {
      this.rampTo(v.gain, 0, now, seconds)
      v.source.stop(now + seconds)
    } catch (err) {
      // stop() throws if the source already ended. Make sure it is gone.
      console.error(err)
      this.remove(v)
      return
    }
    // onended normally removes the voice. This is a safety net in case it never fires.
    setTimeout(() => this.remove(v), (seconds + 1) * 1000)
  }

  /** Cuts short a sound that is already fading out. */
  private forceStop(v: Voice) {
    const now = this.now()
    try {
      this.rampTo(v.gain, 0, now, PANIC_FADE_SECONDS)
      v.source.stop(now + PANIC_FADE_SECONDS)
    } catch {
      // Disconnecting silences it in any case.
      this.remove(v)
    }
  }

  /**
   * Ends the test tone early with a very short fade, so a second click or Stop all does not
   * make a loud click. The nodes are let go once the fade is over.
   */
  private stopTone() {
    const tone = this.tone
    if (!tone) return
    this.tone = null
    const release = () => {
      tone.osc.onended = null
      try {
        tone.osc.disconnect()
        tone.gain.disconnect()
      } catch {
        // Nothing to do: the nodes are dropped anyway.
      }
    }
    try {
      const now = this.ctx?.currentTime ?? 0
      const param = tone.gain.gain
      param.cancelScheduledValues(now)
      param.setValueAtTime(param.value, now)
      param.linearRampToValueAtTime(0, now + QUICK_FADE_SECONDS)
      tone.osc.onended = release
      tone.osc.stop(now + QUICK_FADE_SECONDS)
      // A safety net in case onended never fires.
      setTimeout(release, (QUICK_FADE_SECONDS + 1) * 1000)
    } catch {
      // It already ended, or the fade could not be set: cut it now.
      release()
    }
    this.emit()
  }

  private endTone(tone: ToneVoice) {
    if (this.tone !== tone) return
    this.tone = null
    tone.osc.onended = null
    try {
      tone.osc.disconnect()
      tone.gain.disconnect()
    } catch {
      // Nothing to do: the nodes are dropped anyway.
    }
    this.emit()
  }

  private remove(v: Voice) {
    const i = this.voices.indexOf(v)
    if (i === -1) return
    this.voices.splice(i, 1)
    v.source.onended = null
    try {
      v.source.disconnect()
      v.gain.disconnect()
    } catch {
      // Nothing to do: the nodes are dropped anyway.
    }
    this.emit()
  }
}

function bufferBytes(b: AudioBufferLike): number {
  return b.length * b.numberOfChannels * 4
}

function tooBig(b: AudioBufferLike): boolean {
  return b.duration > MAX_SOUND_SECONDS + 1 || bufferBytes(b) > MAX_DECODED_BYTES
}

/** The app wide sound engine. */
export const audioEngine = new AudioEngine()
