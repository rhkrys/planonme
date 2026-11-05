// Sound pad hotkeys: one key each, unique in a workshop, and never a key the app uses itself.

/** Keys other than letters that a sound can use. */
const EXTRA_KEYS = new Set([',', ';', "'", '-', '=', '[', ']', '\\', '`'])

/** Why a key is kept for the app. Letters are stored in lower case. */
const RESERVED: Record<string, string> = {
  ' ': 'Space is kept for GO in Run mode.',
  b: 'B is kept for the blank screen.',
  '.': 'The full stop is kept for the blank screen.',
  l: 'L is kept for the logo screen.',
  '/': 'This key is kept for keyboard help.',
  '?': 'This key is kept for keyboard help.',
}

/** The stored form of a key: letters in lower case, other keys as they are. */
export function hotkeyFromKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/** Why a key cannot be a sound hotkey, or null if it can. An empty key means no hotkey. */
export function hotkeyRule(raw: string): string | null {
  if (raw === '') return null
  if ([...raw].length !== 1) return 'Use a single key.'
  const key = hotkeyFromKey(raw)
  const reserved = RESERVED[key]
  if (reserved) return reserved
  if (/^[0-9]$/.test(key)) return 'Number keys are kept for moving between views.'
  if (/^[a-z]$/.test(key) || EXTRA_KEYS.has(key)) return null
  return "Use a letter, or one of these keys: , ; ' - = [ ] \\ `"
}

/** A clean hotkey, or an empty string if the value cannot be used as one. */
export function normalizeHotkey(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return hotkeyRule(raw) === null ? hotkeyFromKey(raw) : ''
}

/**
 * Why a hotkey cannot be given to a sound, or null if it can. Checks the key itself and that no
 * other sound already uses it.
 */
export function hotkeyProblem(
  raw: string,
  others: readonly { id: string; name: string; hotkey: string }[],
  selfId: string | null,
): string | null {
  const rule = hotkeyRule(raw)
  if (rule) return rule
  if (raw === '') return null
  const key = hotkeyFromKey(raw)
  const taken = others.find((s) => s.id !== selfId && normalizeHotkey(s.hotkey) === key)
  return taken ? `"${taken.name}" already uses this key.` : null
}

/** How a hotkey is shown to the user. */
export function hotkeyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key
}
