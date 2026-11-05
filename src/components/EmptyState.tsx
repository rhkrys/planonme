import { useState } from 'react'
import { buildSampleWorkshop } from '../sample/sampleWorkshop'
import { useWorkshopStore, type LoadStatus } from '../store/workshopStore'

/**
 * Adds the sample workshop and opens it. Errors show in the workshop bar like every other
 * workshop error.
 */
export function LoadSampleButton({ primary = false }: { primary?: boolean }) {
  const createSample = useWorkshopStore((s) => s.createSampleWorkshop)
  const ready = useWorkshopStore((s) => s.status === 'ready')
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    try {
      await createSample(() => buildSampleWorkshop())
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={primary ? 'btn primary' : 'btn'}
      disabled={!ready || busy}
      onClick={() => void load()}
    >
      {busy ? 'Adding sample...' : 'Load sample workshop'}
    </button>
  )
}

/** Shown by a view while no workshop is open: loading, failed, or none made yet. */
export function NoWorkshop({ status }: { status: LoadStatus }) {
  if (status === 'idle' || status === 'loading') return <p className="muted">Loading...</p>
  if (status === 'error') {
    return (
      <p className="muted">
        Saved workshops could not be opened. Use Try again at the top of the page.
      </p>
    )
  }
  return (
    <div className="empty">
      <p>No workshop yet.</p>
      <p className="muted">Use New at the top to create one, or try a ready made sample.</p>
      <div className="empty-actions">
        <LoadSampleButton primary />
      </div>
    </div>
  )
}
