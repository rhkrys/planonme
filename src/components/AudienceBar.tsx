import { audienceStore, useAudienceStore } from '../store/audienceStore'
import { openAudienceWindow } from '../sync/popup'

/** Opens the audience window and shows whether one is connected. Shown on every view. */
export function AudienceBar() {
  const connected = useAudienceStore((s) => s.connected)

  function open() {
    const result = openAudienceWindow()
    audienceStore.getState().setPopupBlocked(result === 'blocked')
  }

  return (
    <div className="audience-bar">
      <button type="button" className="btn primary" onClick={open}>
        Open audience window
      </button>
      <span
        className={connected ? 'connection on' : 'connection'}
        data-testid="audience-connection"
        aria-live="polite"
      >
        <span className="connection-dot" aria-hidden="true" />
        {connected ? 'Connected' : 'Not connected'}
      </span>
    </div>
  )
}

/** How to allow the popup, shown after the browser blocked it. */
export function PopupBlockedHelp() {
  const blocked = useAudienceStore((s) => s.popupBlocked)
  if (!blocked) return null
  return (
    <div className="message error popup-help" role="alert">
      <div>
        <p>
          <strong>The browser blocked the audience window.</strong>
        </p>
        <p>
          Click the blocked popup icon at the right end of the address bar, choose to always allow
          popups from this site, then click Open audience window again.
        </p>
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => audienceStore.getState().setPopupBlocked(false)}
      >
        Dismiss
      </button>
    </div>
  )
}
