// Small sounds made in code, written as 16 bit mono PCM WAV files.

/** Encodes samples between -1 and 1 as a mono 16 bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return new Uint8Array(buffer)
}

export interface Tone {
  /** Start time in seconds. */
  at: number
  freq: number
  /** Length in seconds. */
  length: number
  /** Peak level from 0 to 1. */
  level: number
  /** How fast the tone fades: larger is a shorter, more bell like sound. */
  decay: number
}

/** Mixes decaying sine tones into a buffer of the given length. */
export function renderTones(tones: readonly Tone[], seconds: number, sampleRate: number) {
  const out = new Float32Array(Math.max(1, Math.round(seconds * sampleRate)))
  const attack = Math.round(0.005 * sampleRate)
  for (const t of tones) {
    const start = Math.round(t.at * sampleRate)
    const length = Math.round(t.length * sampleRate)
    const release = Math.min(length, Math.round(0.02 * sampleRate))
    for (let i = 0; i < length && start + i < out.length; i++) {
      const time = i / sampleRate
      let env = t.level * Math.exp(-t.decay * time)
      if (i < attack) env *= i / attack
      if (i > length - release) env *= (length - i) / release
      const index = start + i
      out[index] = (out[index] ?? 0) + env * Math.sin(2 * Math.PI * t.freq * time)
    }
  }
  return out
}
