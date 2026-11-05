import { useEffect, useRef } from 'react'
import { VIEWS, type ViewId } from '../views'
import { isTyping } from './useAudienceKeys'

export interface AppKeyHandlers {
  /** Called with the view of a number key, 1 to 6. */
  onView: (view: ViewId) => void
  /** Called on the ? key. */
  onHelp: () => void
  /** While true (for example while a dialog is open), the keys do nothing. */
  paused?: boolean
}

/**
 * App wide keys: ? shows the keyboard help, and the number keys open the views in sidebar
 * order. Keys typed into a text field, a list box and the like are left alone.
 */
export function useAppKeys(handlers: AppKeyHandlers) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const h = latest.current
      if (h.paused || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      if (e.key === '?') {
        if (e.repeat) return
        e.preventDefault()
        h.onHelp()
        return
      }
      if (e.shiftKey || e.repeat) return
      const view = VIEWS.find((v) => v.hotkey === e.key)
      if (!view) return
      e.preventDefault()
      h.onView(view.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
