import { useEffect } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { isTyping } from '../components/useAudienceKeys'
import { runStore as appRunStore, type RunState } from './runStore'

function isSpace(e: KeyboardEvent): boolean {
  return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'
}

/**
 * GO on the space bar and Back on Shift+Space, while Run mode is open. Keys typed into a text
 * field, a list box and the like are left alone. Space on a focused button fires GO instead of
 * clicking the button, so GO always does the same thing.
 */
export function useRunKeys(store: StoreApi<RunState> = appRunStore) {
  useEffect(() => {
    function skip(e: KeyboardEvent): boolean {
      return (
        !isSpace(e) ||
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        isTyping(e.target)
      )
    }
    function onKeyDown(e: KeyboardEvent) {
      if (skip(e)) return
      e.preventDefault()
      // Holding the key down must not run through the whole script.
      if (e.repeat) return
      if (e.shiftKey) store.getState().back()
      else store.getState().go()
    }
    // A button clicks on key up, so that has to be stopped too.
    function onKeyUp(e: KeyboardEvent) {
      if (!skip(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [store])
}
