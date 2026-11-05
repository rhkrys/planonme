import { encodeWav, renderTones } from './wav'

test('encodeWav writes a mono 16 bit PCM header and clamps samples', () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1, 2]), 8000)
  const view = new DataView(bytes.buffer)
  const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4))
  expect(text(0)).toBe('RIFF')
  expect(text(8)).toBe('WAVE')
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getUint32(24, true)).toBe(8000)
  expect(view.getUint32(40, true)).toBe(8)
  expect(view.getInt16(46, true)).toBe(32767)
  expect(view.getInt16(48, true)).toBe(-32767)
  expect(view.getInt16(50, true)).toBe(32767)
})

test('renderTones fits tones into the buffer and stays in range', () => {
  const out = renderTones(
    [
      { at: 0, freq: 440, length: 0.5, level: 0.5, decay: 2 },
      { at: 0.9, freq: 660, length: 0.5, level: 0.5, decay: 2 },
    ],
    1,
    8000,
  )
  expect(out).toHaveLength(8000)
  expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1)
  expect(out.some((v) => v !== 0)).toBe(true)
})
