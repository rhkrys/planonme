import { makeWav } from '../test/media'
import { audioTypeOf, detectAudioType, pickKind, sniffAudioType, soundNameFromFile } from './files'

test('audio types come from the file type, or the extension when it is missing', () => {
  expect(audioTypeOf({ name: 'a.mp3', type: 'audio/mpeg' })).toBe('audio/mpeg')
  expect(audioTypeOf({ name: 'a.MP3', type: '' })).toBe('audio/mpeg')
  expect(audioTypeOf({ name: 'a.wav', type: 'application/octet-stream' })).toBe('audio/wav')
  expect(audioTypeOf({ name: 'a.webm', type: 'video/webm' })).toBe('audio/webm')
  expect(audioTypeOf({ name: 'a.pdf', type: 'application/pdf' })).toBeNull()
  expect(audioTypeOf({ name: 'a.txt', type: '' })).toBeNull()
  expect(audioTypeOf({ name: 'noext', type: '' })).toBeNull()
})

test('sound names come from file names and work inside cues', () => {
  expect(soundNameFromFile('applause_long.mp3')).toBe('applause long')
  expect(soundNameFromFile('[intro] theme.wav')).toBe('(intro) theme')
  expect(soundNameFromFile('.wav')).toBe('Untitled sound')
})

test('auto kind picks music for long sounds', () => {
  expect(pickKind('auto', 3)).toBe('sfx')
  expect(pickKind('auto', 120)).toBe('music')
  expect(pickKind('sfx', 120)).toBe('sfx')
  expect(pickKind('music', 1)).toBe('music')
})

const bytes = (...b: number[]) => new Uint8Array(b)
const text = (s: string) => new TextEncoder().encode(s)

test('audio types can be read from the first bytes of a file', () => {
  expect(sniffAudioType(makeWav(0.01))).toBe('audio/wav')
  expect(sniffAudioType(text('OggS\0\x02'))).toBe('audio/ogg')
  expect(sniffAudioType(text('fLaC\0\0'))).toBe('audio/flac')
  expect(sniffAudioType(text('ID3\x04\0'))).toBe('audio/mpeg')
  expect(sniffAudioType(bytes(0xff, 0xfb, 0x90, 0x64))).toBe('audio/mpeg')
  expect(sniffAudioType(bytes(0xff, 0xf1, 0x50, 0x80))).toBe('audio/aac')
  expect(sniffAudioType(text('\0\0\0\x20ftypM4A '))).toBe('audio/mp4')
  expect(sniffAudioType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('audio/webm')
  expect(sniffAudioType(text('RIFF\0\0\0\0AVI '))).toBeNull()
  expect(sniffAudioType(text('%PDF-1.7'))).toBeNull()
  expect(sniffAudioType(bytes())).toBeNull()
})

test('a file with no type and no known extension is sniffed, a declared other type is not', async () => {
  expect(await detectAudioType(new File([makeWav(0.01)], 'recording', { type: '' }))).toBe(
    'audio/wav',
  )
  expect(
    await detectAudioType(
      new File([makeWav(0.01)], 'clip.bin', { type: 'application/octet-stream' }),
    ),
  ).toBe('audio/wav')
  expect(await detectAudioType(new File([makeWav(0.01)], 'a.txt', { type: 'text/plain' }))).toBe(
    null,
  )
  expect(await detectAudioType(new File(['hello'], 'noext', { type: '' }))).toBeNull()
  expect(await detectAudioType(new File([], 'empty', { type: '' }))).toBeNull()
  const unreadable = Object.assign(new Blob(['x']), { name: 'x' })
  unreadable.slice = () => {
    throw new Error('gone')
  }
  expect(await detectAudioType(unreadable)).toBeNull()
})
