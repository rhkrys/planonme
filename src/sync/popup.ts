/** The window name, so a second click reuses the same audience window. */
export const AUDIENCE_WINDOW_NAME = 'planonme-audience'
export const AUDIENCE_WINDOW_FEATURES = 'popup,width=1280,height=720'

export function audienceUrl(): string {
  return `${import.meta.env.BASE_URL}audience.html`
}

let opened: Window | null = null

export type OpenResult = 'opened' | 'focused' | 'blocked'

/**
 * Opens the audience popup, or brings an already open one to the front. Returns 'blocked' when
 * the browser's popup blocker stopped it.
 */
export function openAudienceWindow(
  open: (url: string, name: string, features: string) => Window | null = (u, n, f) =>
    window.open(u, n, f),
): OpenResult {
  try {
    if (opened && !opened.closed) {
      opened.focus()
      return 'focused'
    }
  } catch {
    // The old window may be in a state where it cannot be touched. Open a new one.
  }
  let win: Window | null = null
  try {
    win = open(audienceUrl(), AUDIENCE_WINDOW_NAME, AUDIENCE_WINDOW_FEATURES)
  } catch (err) {
    console.error(err)
  }
  if (!win || win.closed) {
    opened = null
    return 'blocked'
  }
  opened = win
  try {
    win.focus()
  } catch {
    // Not all browsers allow this. The window is open anyway.
  }
  return 'opened'
}

/** Forgets the remembered window. For tests. */
export function resetAudienceWindow() {
  opened = null
}
