// The control window's side of the audience link. It sends the current screen to the audience
// window, answers a reloaded audience window, keeps track of whether one is connected, and
// remembers the current slide in sessionStorage so a reloaded control window picks up again.

import type { StoreApi } from 'zustand/vanilla'
import { isRecord } from '../db/normalize'
import { validSlide, type SlidePos } from '../slides/decks'
import { screenFor, type AudienceState, type Overlay } from '../store/audienceStore'
import type { WorkshopState } from '../store/workshopStore'
import { sameScreen, type AudienceScreen, type SyncChannel, type SyncMessage } from './protocol'

/** How often the control window asks whether an audience window is there. */
export const HEARTBEAT_MS = 1500
/** No answer for this long means the audience window is gone. */
export const TIMEOUT_MS = 3500
/** How long a fresh control window waits for an open audience window to say what it shows. */
export const ADOPT_WAIT_MS = 400

export const STORAGE_KEY = 'planonme-audience'

interface Saved {
  workshopId: string | null
  slide: SlidePos | null
  overlay: Overlay
}

/** Reads the saved state, or null if there is none or it is not valid. */
export function readSaved(storage: Storage | null): Saved | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw || raw.length > 2000) return null
    const v: unknown = JSON.parse(raw)
    if (!isRecord(v)) return null
    const workshopId =
      typeof v.workshopId === 'string' && v.workshopId.length <= 100 ? v.workshopId : null
    const overlay: Overlay = v.overlay === 'blank' || v.overlay === 'logo' ? v.overlay : 'none'
    let slide: SlidePos | null = null
    if (isRecord(v.slide)) {
      const { deckId, index } = v.slide
      if (
        typeof deckId === 'string' &&
        deckId.length > 0 &&
        deckId.length <= 100 &&
        typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0
      ) {
        slide = { deckId, index }
      }
    }
    return { workshopId, slide, overlay }
  } catch {
    return null
  }
}

function writeSaved(storage: Storage | null, saved: Saved) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Storage can be full or blocked. The slide is then not kept over a reload, which is fine.
  }
}

function defaultStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export interface SyncOptions {
  channel: SyncChannel | null
  audience: StoreApi<AudienceState>
  workshop: StoreApi<WorkshopState>
  storage?: Storage | null
  now?: () => number
  /**
   * Called with a key pressed in the audience window, when this control window is the one whose
   * screen the audience window shows. Defaults to replayKey.
   */
  onKey?: (key: string, shift: boolean) => void
}

/** Acts on a key from the audience window as if it was pressed in this window. */
export function replayKey(key: string, shift: boolean) {
  try {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code: key === ' ' ? 'Space' : '',
        shiftKey: shift,
        cancelable: true,
      }),
    )
  } catch (err) {
    console.error(err)
  }
}

function randomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

/** Starts the link. Returns a function that stops it. */
export function startAudienceSync({
  channel,
  audience,
  workshop,
  storage = defaultStorage(),
  now = () => Date.now(),
  onKey = replayKey,
}: SyncOptions): () => void {
  const myId = randomId()
  // Who sent the screen the audience window reported last: this window, another one, or
  // unknown (null). Keys from the audience window go to the window it shows.
  let shownBy: 'me' | 'other' | null = null
  const saved = readSaved(storage)
  // Set while this module changes the audience store, to tell its changes from the user's.
  let applying = false
  function apply(patch: Partial<AudienceState>) {
    applying = true
    try {
      audience.setState(patch)
    } finally {
      applying = false
    }
  }

  if (saved) apply(saved)

  // A fresh control window (nothing saved) first asks an open audience window what it shows
  // and takes that over, so opening PlanOnMe again does not jump the audience to slide 1.
  let adoptOpen = !saved
  let userActed = false
  let waited = !!saved
  let lastSent: AudienceScreen | null = null
  let awaitingSince: number | null = null
  // Set when another control window (a second PlanOnMe tab) sent a screen after this one did.
  // Holds what this window wanted then. This window then stops resending its own screen until
  // what it wants changes, so two windows never fight over the audience window.
  let yieldedFrom: AudienceScreen | null = null

  function decks() {
    return workshop.getState().media?.decks ?? []
  }

  function desired(): AudienceScreen {
    return screenFor(audience.getState(), decks(), workshop.getState().current?.title ?? '')
  }

  function canSend(): boolean {
    const status = workshop.getState().status
    return waited && (status === 'ready' || status === 'error')
  }

  function send(force = false) {
    if (!channel || !canSend()) return
    const screen = desired()
    if (!force && sameScreen(screen, lastSent)) return
    if (!force && yieldedFrom && sameScreen(screen, yieldedFrom)) return
    yieldedFrom = null
    lastSent = screen
    channel.post({ v: 1, from: 'control', type: 'show', screen, sender: myId })
  }

  /** Keeps the slide valid for the current workshop and its decks. */
  function reconcile() {
    const ws = workshop.getState()
    const current = ws.current
    if (!current) return
    const state = audience.getState()
    if (ws.media === null) {
      if (state.workshopId !== current.id) apply({ workshopId: current.id, slide: null })
      return
    }
    // A null workshop means the slide came from an audience window, so keep it if it fits.
    const sameWorkshop = state.workshopId === current.id || state.workshopId === null
    const slide = validSlide(ws.media.decks, sameWorkshop ? state.slide : null)
    const changed =
      state.workshopId !== current.id ||
      slide?.deckId !== state.slide?.deckId ||
      slide?.index !== state.slide?.index
    if (changed) apply({ workshopId: current.id, slide })
  }

  function adopt(screen: AudienceScreen) {
    adoptOpen = false
    if (screen.mode === 'slide') {
      apply({
        workshopId: null,
        slide: { deckId: screen.deckId, index: screen.index },
        overlay: 'none',
      })
    } else {
      apply({ overlay: screen.mode })
    }
    reconcile()
  }

  function onMessage(message: SyncMessage) {
    if (message.from === 'control') {
      // Another control window drives the audience window now. The newest action wins.
      if (message.type === 'show') {
        yieldedFrom = desired()
        lastSent = message.screen
      }
      return
    }
    if (message.type === 'hello') {
      // A new or reloaded audience window: tell it what to show.
      if (canSend()) send(true)
      return
    }
    if (message.type === 'bye') {
      awaitingSince = null
      shownBy = null
      apply({ connected: false, reported: null, problem: null })
      return
    }
    if (message.type === 'key') {
      const mine = shownBy === 'me' || (shownBy === null && !yieldedFrom)
      if (mine && canSend()) onKey(message.key, message.shift)
      return
    }
    awaitingSince = null
    if (message.by !== undefined) {
      shownBy = message.by === null ? null : message.by === myId ? 'me' : 'other'
    }
    apply({ connected: true, reported: message.screen, problem: message.problem })
    if (adoptOpen && !userActed && message.screen) {
      adopt(message.screen)
      waited = true
      send(true)
      return
    }
    // The audience window shows something else (it missed a message, for example): resend.
    // Not after another control window took over, or the two would resend forever.
    if (canSend() && !yieldedFrom && !sameScreen(message.screen, desired())) send(true)
  }

  const unlisten = channel?.listen(onMessage)

  const unsubAudience = audience.subscribe((state, prev) => {
    if (!applying && (state.slide !== prev.slide || state.overlay !== prev.overlay)) {
      userActed = true
      adoptOpen = false
      waited = true
    }
    if (
      state.slide !== prev.slide ||
      state.overlay !== prev.overlay ||
      state.workshopId !== prev.workshopId
    ) {
      writeSaved(storage, {
        workshopId: state.workshopId,
        slide: state.slide,
        overlay: state.overlay,
      })
    }
    send()
  })

  const unsubWorkshop = workshop.subscribe((state, prev) => {
    if (state.current !== prev.current || state.media !== prev.media) reconcile()
    send()
  })

  reconcile()

  function ping() {
    if (!channel) return
    if (awaitingSince !== null && now() - awaitingSince > TIMEOUT_MS) {
      if (audience.getState().connected) apply({ connected: false, reported: null, problem: null })
    }
    if (awaitingSince === null) awaitingSince = now()
    channel.post({ v: 1, from: 'control', type: 'hello' })
  }

  ping()
  const heartbeat = setInterval(ping, HEARTBEAT_MS)
  const adoptTimer = setTimeout(() => {
    adoptOpen = false
    if (!waited) {
      waited = true
      send(true)
    }
  }, ADOPT_WAIT_MS)
  if (waited) send()

  return () => {
    clearInterval(heartbeat)
    clearTimeout(adoptTimer)
    unlisten?.()
    unsubAudience()
    unsubWorkshop()
  }
}
