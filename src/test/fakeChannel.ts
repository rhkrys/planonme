import { parseMessage, type SyncChannel, type SyncMessage } from '../sync/protocol'

/**
 * An in-memory stand-in for BroadcastChannel. Messages reach every other endpoint of the same
 * bus in a microtask, after a structured clone, and go through the same checks as real ones.
 */
export function createFakeBus() {
  const endpoints = new Set<{ deliver: (data: unknown) => void }>()
  const sent: SyncMessage[] = []

  function endpoint(): SyncChannel & { sent: SyncMessage[] } {
    const listeners = new Set<(m: SyncMessage) => void>()
    const own = {
      deliver: (data: unknown) => {
        const m = parseMessage(data)
        if (m) for (const l of listeners) l(m)
      },
    }
    endpoints.add(own)
    const mine: SyncMessage[] = []
    return {
      sent: mine,
      post: (message) => {
        mine.push(message)
        sent.push(message)
        const data = structuredClone(message)
        for (const e of endpoints) if (e !== own) queueMicrotask(() => e.deliver(data))
      },
      listen: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      close: () => endpoints.delete(own),
    }
  }

  /** Sends raw data, as junk from another source would arrive. */
  function inject(data: unknown) {
    for (const e of endpoints) queueMicrotask(() => e.deliver(data))
  }

  return { endpoint, inject, sent }
}

/** The last item of a list (the project targets ES2020, which has no Array.prototype.at). */
export function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1]
}
