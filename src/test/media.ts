// Small media files generated in code for tests.

/** Bytes that start with a valid PNG signature. Enough for type checks, not a real image. */
export function fakePngBytes(extra = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8 + extra)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < bytes.length; i++) bytes[i] = i % 251
  return bytes
}

/** A real mono 16 bit PCM WAV file with a sine tone. */
export function makeWav(seconds = 0.05, sampleRate = 8000, freq = 440): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * sampleRate)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
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
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000),
      true,
    )
  }
  return new Uint8Array(buffer)
}
