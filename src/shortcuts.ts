// Every keyboard shortcut the app has, for the help overlay. Keep this in step with the key
// handlers: useAppKeys, useSoundKeys, useAudienceKeys, useRunKeys and the script editor.

export interface Shortcut {
  keys: string[]
  action: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Everywhere',
    shortcuts: [
      { keys: ['?'], action: 'Show or hide this list' },
      {
        keys: ['1', '2', '3', '4', '5', '6'],
        action: 'Go to Plan, Script, Slides, Sounds, Pre-flight or Run',
      },
      { keys: ['Esc'], action: 'Stop all sounds' },
      { keys: ['A sound hotkey'], action: 'Play or stop that sound. Set the keys in Sounds.' },
    ],
  },
  {
    title: 'Run mode',
    shortcuts: [
      { keys: ['Space'], action: 'GO: fire the next cue' },
      { keys: ['Shift', 'Space'], action: 'Back one cue' },
    ],
  },
  {
    title: 'Slides and Run mode',
    shortcuts: [
      { keys: ['Right arrow'], action: 'Next slide' },
      { keys: ['Page Down'], action: 'Next slide (most presentation clickers send this)' },
      { keys: ['Left arrow'], action: 'Previous slide' },
      { keys: ['Page Up'], action: 'Previous slide' },
      { keys: ['B'], action: 'Blank screen on or off' },
      { keys: ['.'], action: 'Blank screen on or off' },
      { keys: ['L'], action: 'Logo screen on or off' },
    ],
  },
  {
    title: 'Script editor',
    shortcuts: [
      { keys: ['['], action: 'Start a cue and show suggestions' },
      { keys: ['Ctrl', 'Space'], action: 'Show suggestions again inside a cue' },
      { keys: ['Up arrow'], action: 'Previous suggestion' },
      { keys: ['Down arrow'], action: 'Next suggestion' },
      { keys: ['Ctrl', 'Home'], action: 'First suggestion' },
      { keys: ['Ctrl', 'End'], action: 'Last suggestion' },
      { keys: ['Enter'], action: 'Insert the suggestion' },
      { keys: ['Tab'], action: 'Insert the suggestion' },
      { keys: ['Esc'], action: 'Close the suggestions' },
    ],
  },
  {
    title: 'Forms',
    shortcuts: [{ keys: ['Esc'], action: 'Cancel a rename, an edit or a delete question' }],
  },
]
