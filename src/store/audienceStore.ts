import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { slideNumber, stepSlide, type SlidePos } from '../slides/decks'
import type { AudienceScreen, SlideProblem } from '../sync/protocol'
import { workshopStore } from './workshopStore'

/** A full screen cover over the current slide. */
export type Overlay = 'none' | 'blank' | 'logo'

export type DeckCounts = readonly { id: string; slideCount: number }[]

export interface AudienceState {
  /** The workshop that slide belongs to, or null before one is chosen. */
  workshopId: string | null
  /** The current slide. It is kept while the blank or logo screen covers it. */
  slide: SlidePos | null
  overlay: Overlay
  /** True while an audience window answers. */
  connected: boolean
  /** What the audience window last said it shows. */
  reported: AudienceScreen | null
  /** Set when the audience window could not show the slide. */
  problem: SlideProblem | null
  /** True after the browser blocked the popup. */
  popupBlocked: boolean
  showSlide: (pos: SlidePos) => void
  /**
   * Moves delta slides forward (or back when negative), across decks. With a cover on, it only
   * takes the cover away.
   */
  step: (delta: number) => void
  toggleBlank: () => void
  toggleLogo: () => void
  setPopupBlocked: (blocked: boolean) => void
}

export function createAudienceStore(getDecks: () => DeckCounts): StoreApi<AudienceState> {
  return createStore<AudienceState>()((set, get) => ({
    workshopId: null,
    slide: null,
    overlay: 'none',
    connected: false,
    reported: null,
    problem: null,
    popupBlocked: false,

    showSlide: (pos) => {
      if (slideNumber(getDecks(), pos) === null) return
      set({ slide: pos, overlay: 'none' })
    },

    step: (delta) => {
      const { slide, overlay } = get()
      // With the blank or logo screen on, the first step only uncovers the current slide.
      if (overlay !== 'none' && slide && slideNumber(getDecks(), slide) !== null) {
        set({ overlay: 'none' })
        return
      }
      const next = stepSlide(getDecks(), slide, delta)
      if (next) set({ slide: next, overlay: 'none' })
    },

    toggleBlank: () => set((s) => ({ overlay: s.overlay === 'blank' ? 'none' : 'blank' })),
    toggleLogo: () => set((s) => ({ overlay: s.overlay === 'logo' ? 'none' : 'logo' })),
    setPopupBlocked: (popupBlocked) => set({ popupBlocked }),
  }))
}

/**
 * The screen the audience should see: the cover if one is on, else the current slide, else
 * the logo screen (when there are no slides yet).
 */
export function screenFor(
  state: Pick<AudienceState, 'slide' | 'overlay'>,
  decks: DeckCounts,
  title: string,
): AudienceScreen {
  if (state.overlay === 'blank') return { mode: 'blank' }
  const logo: AudienceScreen = { mode: 'logo', title }
  if (state.overlay === 'logo' || !state.slide) return logo
  const number = slideNumber(decks, state.slide)
  if (number === null) return logo
  return { mode: 'slide', deckId: state.slide.deckId, index: state.slide.index, number }
}

/** The decks of the current workshop, in slide order. */
export function currentDecks(): DeckCounts {
  return workshopStore.getState().media?.decks ?? []
}

/** The app wide audience store of the control window. */
export const audienceStore = createAudienceStore(currentDecks)

export function useAudienceStore<T>(selector: (state: AudienceState) => T): T {
  return useStore(audienceStore, selector)
}
