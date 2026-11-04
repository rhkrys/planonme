import { useRef, useState, type FormEvent } from 'react'
import { BACKUP_EXTENSION } from '../db/backup'
import { LIMITS } from '../db/limits'
import { useWorkshopStore } from '../store/workshopStore'

type Mode = { kind: 'idle' } | { kind: 'new' } | { kind: 'rename' } | { kind: 'delete' }

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Top bar to pick, create, rename, delete, export and import workshops. */
export function WorkshopBar() {
  const status = useWorkshopStore((s) => s.status)
  const workshops = useWorkshopStore((s) => s.workshops)
  const current = useWorkshopStore((s) => s.current)
  const error = useWorkshopStore((s) => s.error)
  const notice = useWorkshopStore((s) => s.notice)
  const actions = useWorkshopStore((s) => s)

  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const ready = status === 'ready' && !busy

  async function withBusy(task: () => Promise<unknown>) {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  function startNew() {
    actions.clearMessages()
    setName('')
    setMode({ kind: 'new' })
  }

  function startRename() {
    if (!current) return
    actions.clearMessages()
    setName(current.title)
    setMode({ kind: 'rename' })
  }

  async function submitName(e: FormEvent) {
    e.preventDefault()
    const title = name.trim()
    if (!title) return
    await withBusy(async () => {
      if (mode.kind === 'new') await actions.createWorkshop(title)
      else if (mode.kind === 'rename' && current) await actions.renameWorkshop(current.id, title)
    })
    setMode({ kind: 'idle' })
  }

  async function confirmDelete() {
    if (!current) return
    await withBusy(() => actions.deleteWorkshop(current.id))
    setMode({ kind: 'idle' })
  }

  async function exportCurrent() {
    await withBusy(async () => {
      const file = await actions.exportCurrent()
      if (file) download(file.filename, file.blob)
    })
  }

  async function importChosen(files: FileList | null) {
    const file = files?.[0]
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    await withBusy(() => actions.importFile(file))
  }

  return (
    <div className="topbar">
      <div className="topbar-row">
        {mode.kind === 'new' || mode.kind === 'rename' ? (
          <form className="inline-form" onSubmit={submitName}>
            <input
              aria-label="Workshop name"
              value={name}
              maxLength={LIMITS.maxTitleLength}
              autoFocus
              placeholder="Workshop name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMode({ kind: 'idle' })
              }}
            />
            <button type="submit" className="btn primary" disabled={!ready || !name.trim()}>
              {mode.kind === 'new' ? 'Create' : 'Save name'}
            </button>
            <button type="button" className="btn" onClick={() => setMode({ kind: 'idle' })}>
              Cancel
            </button>
          </form>
        ) : mode.kind === 'delete' && current ? (
          <div
            className="inline-form"
            role="group"
            aria-label="Confirm delete"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMode({ kind: 'idle' })
            }}
          >
            <span>
              Delete "{current.title}" with all its slides and sounds? This can not be undone.
            </span>
            <button type="button" className="btn danger" disabled={!ready} onClick={confirmDelete}>
              Yes, delete
            </button>
            {/* Focus the safe choice, so keyboard users land here and Enter does not delete. */}
            <button
              type="button"
              className="btn"
              autoFocus
              onClick={() => setMode({ kind: 'idle' })}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <label className="picker">
              <span className="muted">Workshop</span>
              <select
                aria-label="Current workshop"
                value={current?.id ?? ''}
                disabled={!ready || workshops.length === 0}
                onChange={(e) => void withBusy(() => actions.selectWorkshop(e.target.value))}
              >
                {workshops.length === 0 && <option value="">No workshops</option>}
                {workshops.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" disabled={!ready} onClick={startNew}>
              New
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready || !current}
              onClick={startRename}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready || !current}
              onClick={() => {
                actions.clearMessages()
                setMode({ kind: 'delete' })
              }}
            >
              Delete
            </button>
            <span className="topbar-spacer" />
            <button
              type="button"
              className="btn"
              disabled={!ready || !current}
              onClick={exportCurrent}
            >
              Export
            </button>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              onClick={() => fileInput.current?.click()}
            >
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              className="visually-hidden"
              tabIndex={-1}
              aria-label="Import backup file"
              accept={`${BACKUP_EXTENSION},application/json`}
              onChange={(e) => void importChosen(e.target.files)}
            />
          </>
        )}
      </div>
      {status === 'loading' && <p className="muted">Loading workshops...</p>}
      {status === 'error' && (
        <div className="message error">
          <span>Saved workshops could not be opened.</span>
          <button type="button" className="btn" onClick={() => void actions.init()}>
            Try again
          </button>
        </div>
      )}
      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={actions.clearMessages}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="message ok" role="status">
          <span>{notice}</span>
        </div>
      )}
    </div>
  )
}
