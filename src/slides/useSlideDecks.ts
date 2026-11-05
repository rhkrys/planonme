import { useEffect, useState } from 'react'
import type { SlideDeck } from '../db/types'
import { useWorkshopStore, workshopStore } from '../store/workshopStore'

/**
 * The current workshop's decks with their images. Null while they load or when no workshop is
 * open; failed is true when they could not be read (decks is then an empty list).
 */
export function useSlideDecks(): { decks: SlideDeck[] | null; failed: boolean } {
  const currentId = useWorkshopStore((s) => s.currentId)
  const media = useWorkshopStore((s) => s.media)
  const [loaded, setLoaded] = useState<{ id: string; decks: SlideDeck[]; failed: boolean } | null>(
    null,
  )

  useEffect(() => {
    let stale = false
    if (!currentId) return
    void workshopStore
      .getState()
      .loadSlideDecks()
      .then((result) => {
        if (stale) return
        setLoaded({ id: currentId, decks: result ?? [], failed: result === null })
      })
    return () => {
      stale = true
    }
  }, [currentId, media])

  if (!currentId || loaded?.id !== currentId) return { decks: null, failed: false }
  return { decks: loaded.decks, failed: loaded.failed }
}
