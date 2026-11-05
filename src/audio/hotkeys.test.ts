import { hotkeyLabel, hotkeyProblem, hotkeyRule, normalizeHotkey } from './hotkeys'

test('letters and a few symbols can be hotkeys', () => {
  for (const key of ['a', 'Q', 'z', ',', ';', '-', '[', '`']) expect(hotkeyRule(key)).toBeNull()
  expect(hotkeyRule('')).toBeNull()
})

test('keys the app uses are refused with a reason', () => {
  expect(hotkeyRule(' ')).toMatch(/GO/)
  expect(hotkeyRule('b')).toMatch(/blank/)
  expect(hotkeyRule('B')).toMatch(/blank/)
  expect(hotkeyRule('.')).toMatch(/blank/)
  expect(hotkeyRule('L')).toMatch(/logo/)
  expect(hotkeyRule('3')).toMatch(/Number keys/)
  expect(hotkeyRule('0')).toMatch(/Number keys/)
  expect(hotkeyRule('?')).toMatch(/help/)
  expect(hotkeyRule('ArrowLeft')).toBe('Use a single key.')
  expect(hotkeyRule('Escape')).toBe('Use a single key.')
  expect(hotkeyRule('ab')).toBe('Use a single key.')
  expect(hotkeyRule('é')).toMatch(/Use a letter/)
  expect(hotkeyRule('+')).toMatch(/Use a letter/)
})

test('normalizeHotkey cleans stored values', () => {
  expect(normalizeHotkey('A')).toBe('a')
  expect(normalizeHotkey('b')).toBe('')
  expect(normalizeHotkey('F1')).toBe('')
  expect(normalizeHotkey(42)).toBe('')
  expect(normalizeHotkey(undefined)).toBe('')
})

test('hotkeys must be unique in a workshop', () => {
  const sounds = [
    { id: '1', name: 'Applause', hotkey: 'a' },
    { id: '2', name: 'Gong', hotkey: '' },
  ]
  expect(hotkeyProblem('A', sounds, '2')).toBe('"Applause" already uses this key.')
  expect(hotkeyProblem('a', sounds, '1')).toBeNull()
  expect(hotkeyProblem('g', sounds, null)).toBeNull()
  expect(hotkeyProblem('', sounds, null)).toBeNull()
  expect(hotkeyProblem('l', sounds, null)).toMatch(/logo/)
})

test('hotkeyLabel shows letters in upper case', () => {
  expect(hotkeyLabel('a')).toBe('A')
  expect(hotkeyLabel(';')).toBe(';')
})
