import { useEffect, useRef, type KeyboardEvent } from 'react'
import { SHORTCUT_GROUPS } from '../shortcuts'

const TITLE_ID = 'shortcut-help-title'

/**
 * The keyboard shortcut list, as a modal dialog. Esc, ? and the close button close it. While it
 * is open, keys stay inside it, so Space does not fire GO and arrows do not change slides.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Focus the close button, and give focus back to where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])

  // Focus can still end up outside the dialog, for example on the page body. Keys pressed there
  // must not reach the app either, or Space would fire GO behind the dialog.
  useEffect(() => {
    function onWindowKey(e: globalThis.KeyboardEvent) {
      const dialog = dialogRef.current
      if (!dialog || (e.target instanceof Node && dialog.contains(e.target))) return
      e.stopPropagation()
      e.preventDefault()
      if (e.type !== 'keydown') return
      if (e.key === 'Escape' || e.key === '?') onCloseRef.current()
      else closeRef.current?.focus()
    }
    window.addEventListener('keydown', onWindowKey, true)
    window.addEventListener('keyup', onWindowKey, true)
    return () => {
      window.removeEventListener('keydown', onWindowKey, true)
      window.removeEventListener('keyup', onWindowKey, true)
    }
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // The app's own key handlers listen on the window, so they never see keys pressed in here.
    e.stopPropagation()
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    // Keep Tab inside the dialog.
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="dialog shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        // A click on the text inside keeps focus in the dialog.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-head">
          <h2 id={TITLE_ID}>Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Shortcuts do not work while you type in a text field. Click outside the field first.
        </p>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl className="shortcut-list">
                {group.shortcuts.map((s) => (
                  <div key={`${s.keys.join('+')} ${s.action}`} className="shortcut">
                    <dt>
                      {s.keys.length > 1 && s.keys.every((k) => /^\d$/.test(k))
                        ? keyRange(s.keys)
                        : s.keys.map((k, i) => (
                            <span key={k}>
                              {i > 0 && <span aria-hidden="true"> + </span>}
                              <kbd>{k}</kbd>
                            </span>
                          ))}
                    </dt>
                    <dd>{s.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Number keys as a range, such as 1 to 6. */
function keyRange(keys: string[]) {
  return (
    <>
      <kbd>{keys[0]}</kbd> to <kbd>{keys[keys.length - 1]}</kbd>
    </>
  )
}
