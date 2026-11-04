import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { BackupError, exportWorkshop, importWorkshop, type ExportedFile } from '../db/backup'
import { PlanOnMeDB } from '../db/db'
import {
  createWorkshop,
  deleteWorkshop,
  getCurrentWorkshopId,
  getMediaSummary,
  getWorkshop,
  listWorkshops,
  renameWorkshop,
  setCurrentWorkshopId,
  updateWorkshop,
  WorkshopNotFoundError,
  type MediaSummary,
} from '../db/repo'
import type { Workshop, WorkshopSummary } from '../db/types'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type WorkshopPatch = Partial<Pick<Workshop, 'title' | 'date' | 'durationMin' | 'blocks'>>

export interface WorkshopState {
  status: LoadStatus
  workshops: WorkshopSummary[]
  currentId: string | null
  current: Workshop | null
  /** A readable error for the user, or null. */
  error: string | null
  /** A short success message for the user, or null. */
  notice: string | null
  /** Edits of the current workshop that are not written to storage yet. */
  pendingSaves: number
  /**
   * Names and counts of the current workshop's slides and sounds, or null while they are not
   * loaded or could not be read.
   */
  media: MediaSummary | null
  init: () => Promise<void>
  createWorkshop: (title: string) => Promise<void>
  selectWorkshop: (id: string) => Promise<void>
  renameWorkshop: (id: string, title: string) => Promise<void>
  deleteWorkshop: (id: string) => Promise<void>
  updateCurrent: (patch: WorkshopPatch) => Promise<void>
  exportCurrent: () => Promise<ExportedFile | null>
  importFile: (file: Blob) => Promise<boolean>
  clearMessages: () => void
  /** Reloads the media summary, for example after adding a slide deck or a sound. */
  refreshMedia: () => Promise<void>
}

export const FIRST_WORKSHOP_TITLE = 'My workshop'

function describe(err: unknown, fallback: string): string {
  if (err instanceof BackupError || err instanceof WorkshopNotFoundError) return err.message
  if (err instanceof Error && err.name === 'QuotaExceededError') {
    return 'Browser storage is full. Delete some workshops or media and try again.'
  }
  return fallback
}

export function createWorkshopStore(getDb: () => PlanOnMeDB): StoreApi<WorkshopState> {
  return createStore<WorkshopState>()((set, get) => {
    /** Reloads the list and the current workshop, falling back to the first one. */
    async function refresh(preferredId: string | null): Promise<void> {
      const db = getDb()
      const workshops = await listWorkshops(db)
      const wanted = preferredId && workshops.some((w) => w.id === preferredId) ? preferredId : null
      const id = wanted ?? workshops[0]?.id ?? null
      const current = id ? await getWorkshop(db, id) : null
      const media = current ? await loadMedia(current) : null
      set({ workshops, currentId: current?.id ?? null, current, media })
      await setCurrentWorkshopId(db, current?.id ?? null)
    }

    /** Media names are only used for hints, so a failure here never blocks the workshop. */
    async function loadMedia(workshop: Workshop): Promise<MediaSummary | null> {
      try {
        return await getMediaSummary(getDb(), workshop)
      } catch (err) {
        console.error(err)
        return null
      }
    }

    async function attempt(action: () => Promise<void>, failure: string): Promise<boolean> {
      try {
        await action()
        return true
      } catch (err) {
        console.error(err)
        set({ error: describe(err, failure), notice: null })
        return false
      }
    }

    // Writes run one at a time, in the order they were asked for. Without this, a slow save
    // could finish after a newer one and overwrite it.
    let queue: Promise<unknown> = Promise.resolve()
    // Counts calls to updateCurrent, so a finished save can tell if a newer edit exists.
    let editSeq = 0
    function run(action: () => Promise<void>, failure: string): Promise<boolean> {
      const next = queue.then(() => attempt(action, failure))
      queue = next
      return next
    }

    return {
      status: 'idle',
      workshops: [],
      currentId: null,
      current: null,
      error: null,
      notice: null,
      pendingSaves: 0,
      media: null,

      init: async () => {
        if (get().status === 'loading' || get().status === 'ready') return
        set({ status: 'loading', error: null })
        const ok = await run(async () => {
          const db = getDb()
          if ((await listWorkshops(db)).length === 0) {
            await createWorkshop(db, FIRST_WORKSHOP_TITLE)
          }
          await refresh(await getCurrentWorkshopId(db))
        }, 'Could not open saved workshops. Browser storage may be blocked or full.')
        set({ status: ok ? 'ready' : 'error' })
      },

      createWorkshop: async (title) => {
        await run(async () => {
          const w = await createWorkshop(getDb(), title)
          await refresh(w.id)
          set({ error: null, notice: null })
        }, 'Could not create the workshop.')
      },

      selectWorkshop: async (id) => {
        await run(async () => {
          await refresh(id)
          set({ error: null, notice: null })
        }, 'Could not open the workshop.')
      },

      renameWorkshop: async (id, title) => {
        await run(async () => {
          await renameWorkshop(getDb(), id, title)
          await refresh(get().currentId)
          set({ error: null, notice: null })
        }, 'Could not rename the workshop.')
      },

      deleteWorkshop: async (id) => {
        await run(async () => {
          await deleteWorkshop(getDb(), id)
          const currentId = get().currentId
          await refresh(currentId === id ? null : currentId)
          set({ error: null, notice: null })
        }, 'Could not delete the workshop.')
      },

      updateCurrent: async (patch) => {
        const current = get().current
        if (!current) return
        // Apply the change right away, so the next patch builds on this one and is not lost.
        const next: Workshop = { ...current, ...patch }
        const seq = ++editSeq
        set((s) => ({ current: next, pendingSaves: s.pendingSaves + 1 }))
        const ok = await run(async () => {
          // Apply the patch to what is stored now, so a change written in between (such as a
          // rename from the workshop bar) is kept and not overwritten with older values.
          const db = getDb()
          const stored = await getWorkshop(db, next.id)
          if (!stored) throw new WorkshopNotFoundError()
          const saved = await updateWorkshop(db, { ...stored, ...patch })
          set((s) => ({
            // Only the newest edit updates the screen. Older ones would hide newer unsaved
            // edits, which have their own save queued.
            current: seq === editSeq && s.current?.id === saved.id ? saved : s.current,
            workshops: s.workshops.map((w) =>
              w.id === saved.id ? { id: saved.id, title: saved.title } : w,
            ),
          }))
        }, 'Could not save the workshop.')
        if (!ok) {
          // Show what is really stored, keeping the error message.
          const error = get().error
          await attempt(() => refresh(get().currentId), 'Could not open saved workshops.')
          set({ error })
        }
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }))
      },

      exportCurrent: async () => {
        const id = get().currentId
        if (!id) return null
        let file: ExportedFile | null = null
        await run(async () => {
          file = await exportWorkshop(getDb(), id)
          set({ error: null })
        }, 'Could not export the workshop.')
        return file
      },

      importFile: async (file) => {
        return run(async () => {
          const w = await importWorkshop(getDb(), file)
          await refresh(w.id)
          set({ error: null, notice: `Imported "${w.title}".` })
        }, 'Could not import the file.')
      },

      clearMessages: () => set({ error: null, notice: null }),

      refreshMedia: async () => {
        await run(async () => {
          const current = get().current
          if (!current) return
          const media = await loadMedia(current)
          if (get().current?.id === current.id) set({ media })
        }, 'Could not read slides and sounds.')
      },
    }
  })
}

let defaultDb: PlanOnMeDB | null = null
function getDefaultDb(): PlanOnMeDB {
  defaultDb ??= new PlanOnMeDB()
  return defaultDb
}

/** The app wide workshop store. */
export const workshopStore = createWorkshopStore(getDefaultDb)

export function useWorkshopStore<T>(selector: (state: WorkshopState) => T): T {
  return useStore(workshopStore, selector)
}
