// @vitest-environment node
import { base64DecodedLength, base64ToBytes, bytesToBase64, isBase64 } from './base64'

test('round trips bytes of many lengths, including across chunk borders', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 100, 3 * 8192 - 1, 3 * 8192, 3 * 8192 + 1, 70_000]) {
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = (i * 7 + 3) % 256
    const text = bytesToBase64(bytes)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    expect(text).toBe(btoa(binary))
    expect(base64DecodedLength(text)).toBe(len)
    expect(Array.from(base64ToBytes(text))).toEqual(Array.from(bytes))
  }
})

test('rejects malformed base64', () => {
  for (const bad of ['a', 'abc', 'ab=c', '====', 'ab c', 'ab\ncd', 'abc*', '=abc', 'a===']) {
    expect(isBase64(bad)).toBe(false)
    expect(() => base64ToBytes(bad)).toThrow()
  }
  expect(isBase64('')).toBe(true)
  expect(isBase64('ab==')).toBe(true)
  expect(isBase64('abc=')).toBe(true)
})
