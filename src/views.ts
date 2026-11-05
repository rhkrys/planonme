export const VIEWS = [
  { id: 'plan', label: 'Plan', hotkey: '1' },
  { id: 'script', label: 'Script', hotkey: '2' },
  { id: 'slides', label: 'Slides', hotkey: '3' },
  { id: 'sounds', label: 'Sounds', hotkey: '4' },
  { id: 'preflight', label: 'Pre-flight', hotkey: '5' },
  { id: 'run', label: 'Run', hotkey: '6' },
] as const

export type ViewId = (typeof VIEWS)[number]['id']
