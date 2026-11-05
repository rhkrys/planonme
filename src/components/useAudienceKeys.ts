import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { audienceStore as appAudienceStore, type AudienceState } from '../store/audienceStore'

/** True when a key press belongs to a text field, a list box or similar, not to the slides. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return !!target.closest('input, textarea, select, [role="listbox"], [role="combobox"]')
}

/**
 * Keyboard control of the audience screen while the calling view is open: left and right
 * arrows (and Page Up and Page Down, which most presentation clickers send) change the slide,
 * B (or the full stop key) toggles the blank screen and L the logo screen.
 */
export function useAudienceKeys(store: StoreApi<AudienceState> = appAudienceStore) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const s = store.getState()
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          s.step(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          s.step(-1)
          break
        case 'b':
        case 'B':
        case '.':
          if (e.repeat) return
          s.toggleBlank()
          break
        case 'l':
        case 'L':
          if (e.repeat) return
          s.toggleLogo()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])
}
