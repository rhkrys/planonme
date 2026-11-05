import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { audioEngine, type EngineCue } from '../audio/engine'
import type { MediaNames } from '../cues/describe'
import { slideAt as slideInDecks, type SlidePos } from '../slides/decks'
import { audienceStore, currentDecks, type DeckCounts } from '../store/audienceStore'
import { workshopStore } from '../store/workshopStore'
import { MAX_TIMER_SECONDS } from '../cues/parse'
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
const RUN_KEY = 'planonme.run'

export interface RunState {
  /** The workshop this run belongs to. A different workshop starts a fresh run. */
  workshopId: string | null
  pos: Position
  clock: SessionClock
  /** Session time (ms) when the running block started. */
  blockStartMs: number
  /**
   * Session time (ms) when each block of this run started, by block id. Stepping back into a
   * block, or clicking a cue in it, keeps its time instead of starting it again.
   */
  blockStarts: Record<string, number>
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
  /** Keeps the run across a reload. Optional; without it a reload starts a fresh run. */
  saved?: {
    load: () => unknown
    save: (run: SavedRun) => void
  }
}

/** The part of a run that survives a reload of the control window. */
export interface SavedRun {
  workshopId: string
  pos: Position
  clock: SessionClock
  blockStartMs: number
  blockStarts: Record<string, number>
  timer: CueTimer | null
}

const MAX_SAVED_BLOCKS = 1000

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Reads a saved run back. Stored data is untrusted, so anything odd gives null. */
export function parseSavedRun(raw: unknown, workshopId: string): SavedRun | null {
  if (!isRecord(raw) || raw.workshopId !== workshopId) return null
  const { pos, clock, timer, blockStarts } = raw
  if (!isRecord(pos) || !Number.isInteger(pos.cue) || !Number.isInteger(pos.block)) return null
  if (!isRecord(clock) || typeof clock.running !== 'boolean') return null
  if (!finite(clock.startedAt) || !finite(clock.accumulated) || clock.accumulated < 0) return null
  if (!finite(raw.blockStartMs) || raw.blockStartMs < 0) return null
  let savedTimer: CueTimer | null = null
  if (timer !== null && timer !== undefined) {
    if (!isRecord(timer) || !finite(timer.seconds) || !finite(timer.startedAt)) return null
    if (timer.seconds < 0 || timer.seconds > MAX_TIMER_SECONDS) return null
    savedTimer = { seconds: timer.seconds, startedAt: timer.startedAt }
  }
  const starts: Record<string, number> = {}
  if (isRecord(blockStarts)) {
    for (const [id, ms] of Object.entries(blockStarts).slice(0, MAX_SAVED_BLOCKS)) {
      if (finite(ms) && ms >= 0) starts[id] = ms
    }
  }
  return {
    workshopId,
    pos: { cue: pos.cue as number, block: pos.block as number },
    clock: {
      running: clock.running,
      startedAt: clock.startedAt,
      accumulated: clock.accumulated,
    },
    blockStartMs: raw.blockStartMs,
    blockStarts: starts,
    timer: savedTimer,
  }
}

function startOf(starts: Record<string, number>, id: string | undefined): number | undefined {
  if (id === undefined || !Object.prototype.hasOwnProperty.call(starts, id)) return undefined
  const ms = starts[id]
  return finite(ms) ? ms : undefined
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
  const store = createStore<RunState>()((set, get) => {
    /**
     * Moves to a position. Entering a block that has not run yet starts its time; entering one
     * that already ran (for example with Back) keeps its time. restart starts the block again
     * and forgets the times of the blocks after it.
     */
    function moveTo(plan: RunPlan, pos: Position, extra: Partial<RunState> = {}, restart = false) {
      const s = get()
      const clock = extra.clock ?? s.clock
      const id = plan.blocks[pos.block]?.id
      const known = restart ? undefined : startOf(s.blockStarts, id)
      const blockChanged = pos.block !== s.pos.block
      const start =
        known ?? (blockChanged || restart ? elapsedMs(clock, deps.now()) : s.blockStartMs)
      let blockStarts = s.blockStarts
      if (restart) {
        blockStarts = {}
        for (const b of plan.blocks.slice(0, pos.block)) {
          const ms = startOf(s.blockStarts, b.id)
          if (ms !== undefined) blockStarts[b.id] = ms
        }
      }
      if (id !== undefined && startOf(blockStarts, id) !== start) {
        blockStarts = { ...blockStarts, [id]: start }
      }
      set({ ...extra, pos, blockStartMs: start, blockStarts })
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
      blockStarts: {},
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
            try {
              void deps.playCue(cue).catch(() => false)
            } catch {
              // The engine reports its own errors. A cue must never stop the run.
            }
            break
          case 'timer':
            timer = { seconds: cue.seconds, startedAt: now }
            break
        }
        moveTo(plan, result.pos, { clock, note, timer })
      },

      back: () => {
        const plan = deps.getPlan()
        const pos = back(plan, get().pos)
        moveTo(plan, pos, { note: null })
        syncSlide(plan, pos)
      },

      jumpToCue: (index) => {
        const plan = deps.getPlan()
        const pos = jumpToCue(plan, index)
        if (!pos) return
        moveTo(plan, pos, { note: null })
        syncSlide(plan, pos)
      },

      jumpToBlock: (index) => {
        const plan = deps.getPlan()
        if (!plan.blocks[index]) return
        const pos = jumpToBlock(plan, index)
        // Starting a block again restarts its time, even when it is already running.
        moveTo(plan, pos, { note: null }, true)
        syncSlide(plan, pos)
      },

      startSession: () => set((s) => ({ clock: startClock(s.clock, deps.now()) })),
      pauseSession: () => set((s) => ({ clock: pauseClock(s.clock, deps.now()) })),
      resetSession: () =>
        set({
          pos: clampPosition(deps.getPlan(), START),
          clock: STOPPED,
          blockStartMs: 0,
          blockStarts: {},
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
        let saved: SavedRun | null = null
        if (workshopId !== null && deps.saved) {
          try {
            saved = parseSavedRun(deps.saved.load(), workshopId)
          } catch {
            saved = null
          }
        }
        set({
          workshopId,
          pos: saved?.pos ?? START,
          clock: saved?.clock ?? STOPPED,
          blockStartMs: saved?.blockStartMs ?? 0,
          blockStarts: saved?.blockStarts ?? {},
          timer: saved?.timer ?? null,
          note: null,
        })
      },
    }
  })

  const saved = deps.saved
  if (saved) {
    store.subscribe((s, prev) => {
      if (s.workshopId === null) return
      if (
        s.workshopId === prev.workshopId &&
        s.pos === prev.pos &&
        s.clock === prev.clock &&
        s.blockStartMs === prev.blockStartMs &&
        s.blockStarts === prev.blockStarts &&
        s.timer === prev.timer
      ) {
        return
      }
      try {
        saved.save({
          workshopId: s.workshopId,
          pos: s.pos,
          clock: s.clock,
          blockStartMs: s.blockStartMs,
          blockStarts: s.blockStarts,
          timer: s.timer,
        })
      } catch {
        // Storage can be full or blocked. The run then only lasts until a reload.
      }
    })
  }
  return store
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
  saved: {
    load: () => {
      const raw = globalThis.localStorage?.getItem(RUN_KEY)
      // A saved run is small. Anything big is not ours.
      return raw && raw.length < 200_000 ? (JSON.parse(raw) as unknown) : null
    },
    save: (run) => globalThis.localStorage?.setItem(RUN_KEY, JSON.stringify(run)),
  },
})

export function useRunStore<T>(selector: (state: RunState) => T): T {
  return useStore(runStore, selector)
}
