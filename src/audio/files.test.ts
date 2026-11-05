import { audioTypeOf, pickKind, soundNameFromFile } from './files'

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
