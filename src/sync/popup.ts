/** The window name, so a second click reuses the same audience window. */
export const AUDIENCE_WINDOW_NAME = 'planonme-audience'
export const AUDIENCE_WINDOW_FEATURES = 'popup,width=1280,height=720'

export function audienceUrl(): string {
  return `${import.meta.env.BASE_URL}audience.html`
}

let opened: Window | null = null

export type OpenResult = 'opened' | 'focused' | 'blocked'

type OpenFn = (url: string, name: string, features: string) => Window | null

/** True when win already shows the audience page, so it must not be loaded again. */
function showsAudience(win: Window): boolean {
  try {
    const path = win.location.pathname
    return path === audienceUrl() || path.endsWith('/audience.html')
  } catch {
    // Another origin, or a window that cannot be read: treat it as not ours.
    return false
  }
}

/**
 * Opens the audience popup, or brings an already open one to the front. Returns 'blocked' when
 * the browser's popup blocker stopped it.
 *
 * After the control window reloads it no longer holds the popup, so it first looks the popup up
 * by name with an empty URL. That finds an open audience window without loading it again (which
 * would flash the waiting screen to the audience), and only opens a new window when none is open.
 */
export function openAudienceWindow(open: OpenFn = (u, n, f) => window.open(u, n, f)): OpenResult {
  try {
    if (opened && !opened.closed) {
      opened.focus()
      return 'focused'
    }
  } catch {
    // The old window may be in a state where it cannot be touched. Open a new one.
  }
  opened = null
  let win: Window | null = null
  try {
    win = open('', AUDIENCE_WINDOW_NAME, AUDIENCE_WINDOW_FEATURES)
  } catch (err) {
    console.error(err)
  }
  if (!win || win.closed) return 'blocked'

  let result: OpenResult = 'focused'
  if (!showsAudience(win)) {
    result = 'opened'
    try {
      win.location.replace(audienceUrl())
    } catch (err) {
      console.error(err)
      // Fall back to opening the page by URL, which loads it into the same named window.
      try {
        win = open(audienceUrl(), AUDIENCE_WINDOW_NAME, AUDIENCE_WINDOW_FEATURES)
      } catch (err2) {
        console.error(err2)
        win = null
      }
      if (!win || win.closed) return 'blocked'
    }
  }
  opened = win
  try {
    win.focus()
  } catch {
    // Not all browsers allow this. The window is open anyway.
  }
  return result
}

/** Forgets the remembered window. For tests. */
export function resetAudienceWindow() {
  opened = null
}
