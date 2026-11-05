import { useEffect } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Sound } from '../db/types'
import { useWorkshopStore, workshopStore } from '../store/workshopStore'
import { audioEngine, type AudioEngine } from './engine'

export interface SoundLibraryState {
  /** The workshop the sounds belong to. */
  workshopId: string | null
  /** The sounds with their audio, or null while loading. */
  sounds: Sound[] | null
  /** True when the sounds could not be read. */
  failed: boolean
}

/** The current workshop's sounds with their audio, loaded by useSoundLibrarySync. */
export const soundLibrary = createStore<SoundLibraryState>()(() => ({
  workshopId: null,
  sounds: null,
  failed: false,
}))

export function useSoundLibrary<T>(selector: (s: SoundLibraryState) => T): T {
  return useStore(soundLibrary, selector)
}

/**
 * Keeps the sound library and the engine in step with the current workshop: loads its sounds
 * whenever the workshop or its media change. Mount once, at the top of the app.
 */
export function useSoundLibrarySync(engine: AudioEngine = audioEngine) {
  const status = useWorkshopStore((s) => s.status)
  const currentId = useWorkshopStore((s) => s.currentId)
  const media = useWorkshopStore((s) => s.media)

  useEffect(() => {
    if (status !== 'ready') return
    if (!currentId) {
      soundLibrary.setState({ workshopId: null, sounds: [], failed: false })
      engine.setSounds([])
      return
    }
    let stale = false
    void workshopStore
      .getState()
      .loadSounds()
      .then((sounds) => {
        if (stale) return
        soundLibrary.setState({ workshopId: currentId, sounds: sounds ?? [], failed: !sounds })
        engine.setSounds(sounds ?? [])
      })
    return () => {
      stale = true
    }
  }, [status, currentId, media, engine])
}
