import { useEffect } from 'react'
import { audioEngine as appEngine, type AudioEngine } from './engine'
import { hotkeyFromKey, normalizeHotkey } from './hotkeys'
import { soundLibrary as appLibrary, type SoundLibraryState } from './library'
import type { StoreApi } from 'zustand/vanilla'

/** Input types that do not take typed text, so hotkeys still work while they have focus. */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file'])

/** True when a key press belongs to a text field, a list box or similar. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('textarea, select, [role="listbox"], [role="combobox"]')) return true
  const input = target.closest('input')
  return !!input && !NON_TEXT_INPUTS.has(input.type)
}

/**
 * Keyboard control of the sounds: each sound's hotkey plays it like a click on its pad, and
 * Escape stops all sound. Keys are ignored while typing in a field.
 */
export function useSoundKeys(
  engine: AudioEngine = appEngine,
  library: StoreApi<SoundLibraryState> = appLibrary,
) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      if (e.key === 'Escape') {
        engine.stopAll()
        return
      }
      if (e.repeat || e.key.length !== 1) return
      const key = hotkeyFromKey(e.key)
      const sound = library.getState().sounds?.find((s) => normalizeHotkey(s.hotkey) === key)
      if (!sound) return
      e.preventDefault()
      void engine.play(sound.id, { toggle: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [engine, library])
}
