import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { audioEngine, type EngineCue } from '../audio/engine'
import type { MediaNames } from '../cues/describe'
import { slideAt as slideInDecks, type SlidePos } from '../slides/decks'
import { audienceStore, currentDecks, type DeckCounts } from '../store/audienceStore'
import { workshopStore } from '../store/workshopStore'
import {
  elapsedMs,
  isFresh,
  pauseClock,
  startClock,
  STOPPED,
  type CueTimer,
  type SessionClock,
} from './clock'
import {
  back,
  buildRunPlan,
  clampPosition,
  go,
  jumpToBlock,
  jumpToCue,
  slideAt,
  START,
  type BlockInput,
  type Position,
  type RunCue,
  type RunPlan,
} from './sequencer'

export const MIN_FONT_SIZE = 16
export const MAX_FONT_SIZE = 72
export const FONT_STEP = 4
export const DEFAULT_FONT_SIZE = 28
const FONT_KEY = 'planonme.runFontSize'

export interface RunState {
  /** The workshop this run belongs to. A different workshop starts a fresh run. */
  workshopId: string | null
  pos: Position
  clock: SessionClock
  /** Session time (ms) when the running block started. */
  blockStartMs: number
  /** The countdown of the last [TIMER] cue, or null. */
  timer: CueTimer | null
  /** A short note for the presenter, such as a skipped cue, or null. */
  note: string | null
  /** Teleprompter text size in px. */
  fontSize: number
  /** GO: fires the next cue that can fire and skips the ones that can not. */
  go: () => void
  /** Steps back one cue. Nothing is fired again, but the audience gets the matching slide. */
  back: () => void
  /** Makes a cue the current one without firing it. */
  jumpToCue: (index: number) => void
  /** Starts a block, so GO fires its first cue. */
  jumpToBlock: (index: number) => void
  startSession: () => void
  pauseSession: () => void
  resetSession: () => void
  stopTimer: () => void
  clearNote: () => void
  setFontSize: (px: number) => void
  /** Starts a fresh run when the workshop changes. */
  syncWorkshop: (workshopId: string | null) => void
}

export interface RunDeps {
  getPlan: () => RunPlan
  getDecks: () => DeckCounts
  /** The slide the audience is on, or null. */
  currentSlide: () => SlidePos | null
  showSlide: (pos: SlidePos) => void
  playCue: (cue: EngineCue) => Promise<boolean>
  now: () => number
}

function readFontSize(): number {
  try {
    const raw = globalThis.localStorage?.getItem(FONT_KEY)
    return raw === null || raw === undefined ? DEFAULT_FONT_SIZE : clampFont(Number(raw))
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

function saveFontSize(px: number) {
  try {
    globalThis.localStorage?.setItem(FONT_KEY, String(px))
  } catch {
    // Storage can be blocked. The size then only lasts for this visit.
  }
}

export function clampFont(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)))
}

const MAX_LISTED = 5

/** A readable note about cues that GO passed over. */
export function skippedNote(skipped: readonly RunCue[]): string | null {
  const first = skipped[0]
  if (!first) return null
  if (skipped.length === 1) return `Skipped ${first.raw}. ${first.problem ?? ''}`.trim()
  const listed = skipped.slice(0, MAX_LISTED).map((c) => c.raw)
  const more = skipped.length > MAX_LISTED ? ` and ${skipped.length - MAX_LISTED} more` : ''
  return `Skipped ${skipped.length} cues that cannot run: ${listed.join(', ')}${more}.`
}

function samePos(a: SlidePos | null, b: SlidePos): boolean {
  return !!a && a.deckId === b.deckId && a.index === b.index
}

export function createRunStore(deps: RunDeps): StoreApi<RunState> {
  return createStore<RunState>()((set, get) => {
    /** Moves to a position, restarting the block time when the block changes. */
    function moveTo(pos: Position, extra: Partial<RunState> = {}) {
      const s = get()
      const blockChanged = pos.block !== s.pos.block
      const clock = extra.clock ?? s.clock
      set({
        ...extra,
        pos,
        ...(blockChanged ? { blockStartMs: elapsedMs(clock, deps.now()) } : {}),
      })
    }

    /** Shows the slide that belongs to a position, unless the audience already sees it. */
    function syncSlide(plan: RunPlan, pos: Position) {
      const n = slideAt(plan, pos)
      if (n === null) return
      const target = slideInDecks(deps.getDecks(), n)
      if (target && !samePos(deps.currentSlide(), target)) deps.showSlide(target)
    }

    return {
      workshopId: null,
      pos: START,
      clock: STOPPED,
      blockStartMs: 0,
      timer: null,
      note: null,
      fontSize: readFontSize(),

      go: () => {
        const plan = deps.getPlan()
        const s = get()
        const result = go(plan, s.pos)
        const skipped = skippedNote(result.skipped)
        const fired = result.fired
        if (!fired) {
          const end =
            plan.cues.length === 0
              ? 'There are no cues in the script.'
              : 'End of the script. There are no more cues.'
          set({ note: skipped ? `${skipped} ${end}` : end })
          return
        }
        const now = deps.now()
        // The first GO starts the session clock.
        const clock = isFresh(s.clock) ? startClock(s.clock, now) : s.clock
        let note = skipped
        let timer = s.timer
        const cue = fired.cue
        switch (cue.type) {
          case 'slide': {
            const target = slideInDecks(deps.getDecks(), cue.slide)
            if (target) deps.showSlide(target)
            else note = [note, `Slide ${cue.slide} is not there anymore.`].filter(Boolean).join(' ')
            break
          }
          case 'sfx':
          case 'music':
          case 'stopMusic':
            void deps.playCue(cue).catch(() => false)
            break
          case 'timer':
            timer = { seconds: cue.seconds, startedAt: now }
            break
        }
        moveTo(result.pos, { clock, note, timer })
      },

      back: () => {
        const plan = deps.getPlan()
        const pos = back(plan, get().pos)
        moveTo(pos, { note: null })
        syncSlide(plan, pos)
      },

      jumpToCue: (index) => {
        const plan = deps.getPlan()
        const pos = jumpToCue(plan, index)
        if (!pos) return
        moveTo(pos, { note: null })
        syncSlide(plan, pos)
      },

      jumpToBlock: (index) => {
        const plan = deps.getPlan()
        if (!plan.blocks[index]) return
        const pos = jumpToBlock(plan, index)
        // Starting a block again restarts its time, even when it is already running.
        set({ pos: { ...pos, block: -1 } })
        moveTo(pos, { note: null })
        syncSlide(plan, pos)
      },

      startSession: () => set((s) => ({ clock: startClock(s.clock, deps.now()) })),
      pauseSession: () => set((s) => ({ clock: pauseClock(s.clock, deps.now()) })),
      resetSession: () =>
        set({
          pos: clampPosition(deps.getPlan(), START),
          clock: STOPPED,
          blockStartMs: 0,
          timer: null,
          note: null,
        }),
      stopTimer: () => set({ timer: null }),
      clearNote: () => set({ note: null }),
      setFontSize: (px) => {
        const fontSize = clampFont(px)
        saveFontSize(fontSize)
        set({ fontSize })
      },
      syncWorkshop: (workshopId) => {
        if (get().workshopId === workshopId) return
        set({
          workshopId,
          pos: START,
          clock: STOPPED,
          blockStartMs: 0,
          timer: null,
          note: null,
        })
      },
    }
  })
}

let cached: { blocks: unknown; media: unknown; plan: RunPlan } | null = null
const NO_BLOCKS: readonly BlockInput[] = []

/** The run plan for these blocks and media. The same object while they stay the same. */
export function planFor(
  blocks: readonly BlockInput[] | undefined,
  media: MediaNames | null,
): RunPlan {
  const list = blocks ?? NO_BLOCKS
  if (cached && cached.blocks === list && cached.media === media) return cached.plan
  const plan = buildRunPlan(list, media)
  cached = { blocks: list, media, plan }
  return plan
}

/** The run plan of the current workshop. */
export function currentPlan(): RunPlan {
  const { current, media } = workshopStore.getState()
  return planFor(current?.blocks, media)
}

/** The app wide run store. */
export const runStore = createRunStore({
  getPlan: currentPlan,
  getDecks: currentDecks,
  currentSlide: () => audienceStore.getState().slide,
  showSlide: (pos) => audienceStore.getState().showSlide(pos),
  playCue: (cue) => audioEngine.playCue(cue),
  now: () => Date.now(),
})

export function useRunStore<T>(selector: (state: RunState) => T): T {
  return useStore(runStore, selector)
}
