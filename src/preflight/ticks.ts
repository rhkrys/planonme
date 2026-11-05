// Pre-flight ticks, remembered per workshop for this browser session.
//
// They live in sessionStorage, so they survive a reload of the tab but start empty in a new
// session. What is read back is untrusted: anything unexpected is dropped.

import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { LIMITS } from '../db/limits'
import { isManualId } from './checklist'

export const TICKS_KEY = 'planonme.preflight'
/** Most workshops whose ticks are kept. The oldest are dropped first. */
export const MAX_TICKED_WORKSHOPS = 50

export type TickMap = Record<string, string[]>

export interface TickState {
  /** Ticked item ids by workshop id. */
  ticks: TickMap
  setTick: (workshopId: string, itemId: string, on: boolean) => void
  clear: (workshopId: string) => void
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Reads stored ticks, keeping only valid workshop ids and known item ids. */
export function parseTicks(raw: string | null): TickMap {
  if (!raw || raw.length > 100_000) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: TickMap = {}
  let count = 0
  for (const [id, items] of Object.entries(data as Record<string, unknown>)) {
    if (count >= MAX_TICKED_WORKSHOPS) break
    if (!id || id.length > LIMITS.maxIdLength || !Array.isArray(items)) continue
    const valid = [...new Set(items.filter(isManualId))]
    if (valid.length === 0) continue
    out[id] = valid
    count++
  }
  return out
}

function sessionStore(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export function createTickStore(storage: StorageLike | null = sessionStore()): StoreApi<TickState> {
  function load(): TickMap {
    try {
      return parseTicks(storage?.getItem(TICKS_KEY) ?? null)
    } catch {
      return {}
    }
  }

  function save(ticks: TickMap) {
    try {
      storage?.setItem(TICKS_KEY, JSON.stringify(ticks))
    } catch {
      // Storage can be blocked or full. The ticks then only last until the page reloads.
    }
  }

  return createStore<TickState>()((set, get) => ({
    ticks: load(),

    setTick: (workshopId, itemId, on) => {
      if (!workshopId || !isManualId(itemId)) return
      const ticks = { ...get().ticks }
      const current = ticks[workshopId] ?? []
      const next = on
        ? current.includes(itemId)
          ? current
          : [...current, itemId]
        : current.filter((id) => id !== itemId)
      // Re-insert so the most recently used workshop goes last.
      delete ticks[workshopId]
      if (next.length > 0) ticks[workshopId] = next
      const ids = Object.keys(ticks)
      for (const id of ids.slice(0, Math.max(0, ids.length - MAX_TICKED_WORKSHOPS))) {
        delete ticks[id]
      }
      set({ ticks })
      save(ticks)
    },

    clear: (workshopId) => {
      if (!get().ticks[workshopId]) return
      const ticks = { ...get().ticks }
      delete ticks[workshopId]
      set({ ticks })
      save(ticks)
    },
  }))
}

/** The app wide tick store. */
export const tickStore = createTickStore()

const NONE: string[] = []

/** The ticked item ids of a workshop. */
export function useTicks(workshopId: string | null): string[] {
  return useStore(tickStore, (s) => (workshopId ? (s.ticks[workshopId] ?? NONE) : NONE))
}
