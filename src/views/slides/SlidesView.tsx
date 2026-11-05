import { useEffect, useRef, useState, type DragEvent, type FormEvent, type RefObject } from 'react'
import { NoWorkshop } from '../../components/EmptyState'
import { AudiencePanel } from '../../components/AudiencePanel'
import { LIMITS } from '../../db/limits'
import { DECK_SOURCES, type DeckSource, type SlideDeck } from '../../db/types'
import { deckStarts, slideRangeLabel, SOURCE_LABELS } from '../../slides/decks'
import {
  deckNameFromFile,
  importPdf,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  SlideImportCancelled,
  SlideImportError,
  type ImportProgress,
} from '../../slides/importPdf'
import { audienceStore, useAudienceStore } from '../../store/audienceStore'
import { useWorkshopStore, workshopStore } from '../../store/workshopStore'
import { SlideHelp } from './SlideHelp'

type ImportState =
  | { kind: 'idle' }
  | { kind: 'working'; fileName: string; progress: ImportProgress }
  | { kind: 'saving'; fileName: string }

const MB = 1024 * 1024

export function SlidesView() {
  const status = useWorkshopStore((s) => s.status)
  const currentId = useWorkshopStore((s) => s.currentId)
  const media = useWorkshopStore((s) => s.media)

  // Decks are kept with the workshop they belong to, so another workshop's decks never show
  // (or count toward its limits) while the new ones load.
  const [loaded, setLoaded] = useState<{ id: string; decks: SlideDeck[]; failed: boolean } | null>(
    null,
  )

  // Reload the decks with their images whenever the workshop or its media change.
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

  if (status !== 'ready' || !currentId) {
    return (
      <section className="slides-view">
        <h1>Slides</h1>
        <NoWorkshop status={status} />
      </section>
    )
  }

  const decks = loaded?.id === currentId ? loaded.decks : null
  const loadFailed = loaded?.id === currentId && loaded.failed
  const totalSlides = (decks ?? []).reduce((sum, d) => sum + d.slides.length, 0)

  return (
    <section className="slides-view">
      <h1>Slides</h1>
      <AudiencePanel decks={decks} />
      <ImportPanel
        key={currentId}
        deckCount={decks?.length ?? 0}
        roomForSlides={LIMITS.maxSlidesTotal - totalSlides}
        ready={decks !== null}
      />
      <SlideHelp />
      {loadFailed && (
        <p className="message error" role="alert">
          Could not read the slides. Reload the page to try again.
        </p>
      )}
      {decks === null ? <p className="muted">Loading slides...</p> : <DeckList decks={decks} />}
    </section>
  )
}

function ImportPanel({
  deckCount,
  roomForSlides,
  ready,
}: {
  deckCount: number
  roomForSlides: number
  ready: boolean
}) {
  const [name, setName] = useState('')
  const [source, setSource] = useState<DeckSource>('pdf')
  const [state, setState] = useState<ImportState>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  // Set synchronously, so two files dropped in quick succession cannot start two imports.
  const runningRef = useRef(false)
  // Where keyboard focus should go once the progress view or the file button appears.
  const [focusTo, setFocusTo] = useState<'cancel' | 'file' | null>(null)

  // Stop rendering when the view closes.
  useEffect(() => () => abortRef.current?.abort(), [])

  // A file dropped next to the drop zone would make the browser open it and leave the app.
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const busy = state.kind !== 'idle'

  // The file button disappears while importing and the Cancel button when done. Move focus
  // along with them, but only if it was in this panel and has not gone anywhere else since.
  useEffect(() => {
    if (!focusTo) return
    const active = document.activeElement
    const lost = !active || active === document.body || !!panelRef.current?.contains(active)
    const target = focusTo === 'cancel' ? cancelButton.current : fileInput.current
    if (!target) return
    setFocusTo(null)
    if (lost) target.focus()
  }, [focusTo, state.kind])

  const full = deckCount >= LIMITS.maxDecks || roomForSlides <= 0
  const canImport = ready && !busy && !full

  async function start(file: File) {
    if (!canImport || runningRef.current) {
      // A file picked while the decks are still loading would otherwise be dropped silently.
      if (!ready && !runningRef.current)
        setError('Slides are still loading. Try again in a moment.')
      return
    }
    const workshopId = workshopStore.getState().currentId
    if (!workshopId) return
    runningRef.current = true
    const active = document.activeElement
    const hadFocus = !!active && !!panelRef.current?.contains(active)
    if (hadFocus) setFocusTo('cancel')
    setError(null)
    setInfo(null)
    const controller = new AbortController()
    abortRef.current = controller
    const fileName = file.name || 'PDF'
    setState({ kind: 'working', fileName, progress: { done: 0, total: 0 } })
    try {
      const { slides } = await importPdf(file, {
        signal: controller.signal,
        maxPages: Math.min(roomForSlides, LIMITS.maxSlidesPerDeck),
        onProgress: (progress) => {
          if (!controller.signal.aborted) setState({ kind: 'working', fileName, progress })
        },
      })
      setState({ kind: 'saving', fileName })
      const deckName = name.trim() || deckNameFromFile(file.name)
      const ok = await workshopStore.getState().addSlideDeck(workshopId, {
        name: deckName,
        source,
        slides,
      })
      if (ok) setName('')
    } catch (err) {
      if (err instanceof SlideImportCancelled) {
        setInfo('Import cancelled.')
      } else if (err instanceof SlideImportError) {
        setError(err.message)
      } else {
        console.error(err)
        setError('Could not import this PDF.')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      runningRef.current = false
      setState({ kind: 'idle' })
      if (hadFocus) setFocusTo('file')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    if (files.length > 1) {
      setInfo(null)
      setError('Import one PDF at a time.')
      return
    }
    const file = files[0]
    if (file) void start(file)
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = canImport ? 'copy' : 'none'
    setDragging(true)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (canImport) onFiles(e.dataTransfer.files)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    fileInput.current?.click()
  }

  return (
    <section ref={panelRef} className="slide-import" aria-labelledby="slide-import-title">
      <h2 id="slide-import-title">Import a PDF</h2>
      <form className="slide-import-form" aria-label="Import slides" onSubmit={onSubmit}>
        <div className="field wide">
          <label htmlFor="deck-name">Deck name</label>
          <input
            id="deck-name"
            type="text"
            value={name}
            maxLength={LIMITS.maxTitleLength}
            placeholder="Uses the file name if empty"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="deck-source">Made with</label>
          <select
            id="deck-source"
            value={source}
            disabled={busy}
            onChange={(e) => setSource(e.target.value as DeckSource)}
          >
            {DECK_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </form>
      <div
        className={`drop-zone${dragging ? ' dragging' : ''}${canImport ? '' : ' disabled'}`}
        data-testid="drop-zone"
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {state.kind === 'idle' ? (
          <>
            <p>Drop a PDF here, or</p>
            <label className={`btn primary file-button${canImport ? '' : ' disabled'}`}>
              Choose PDF
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="application/pdf,.pdf"
                aria-label="Choose PDF file"
                disabled={!canImport}
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <p className="hint muted">
              Up to {MAX_PDF_PAGES} pages and {Math.round(MAX_PDF_BYTES / MB)} MB.
            </p>
          </>
        ) : (
          <ImportProgressView
            state={state}
            cancelRef={cancelButton}
            onCancel={() => abortRef.current?.abort()}
          />
        )}
      </div>
      {full && (
        <p className="message warn">
          {deckCount >= LIMITS.maxDecks
            ? `This workshop has ${LIMITS.maxDecks} decks, the most it can hold. Delete one to import more.`
            : `This workshop has ${LIMITS.maxSlidesTotal} slides, the most it can hold. Delete a deck to import more.`}
        </p>
      )}
      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {info && (
        <p className="message ok" role="status">
          {info}
        </p>
      )}
    </section>
  )
}

function ImportProgressView({
  state,
  cancelRef,
  onCancel,
}: {
  state: Exclude<ImportState, { kind: 'idle' }>
  cancelRef: RefObject<HTMLButtonElement | null>
  onCancel: () => void
}) {
  let text: string
  let value: number | undefined
  let max = 1
  if (state.kind === 'saving') {
    text = 'Saving slides...'
  } else if (state.progress.total === 0) {
    text = 'Opening PDF...'
  } else {
    const { done, total } = state.progress
    text = done < total ? `Rendering page ${done + 1} of ${total}` : `Rendered ${total} pages`
    value = done
    max = total
  }
  return (
    <div className="import-progress">
      <p className="import-file">{state.fileName}</p>
      <progress aria-label="Import progress" max={max} value={value} />
      <p aria-live="polite" data-testid="import-status">
        {text}
      </p>
      {state.kind === 'working' && (
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
          Cancel import
        </button>
      )}
    </div>
  )
}

type DeckMode = { kind: 'idle' } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string }

type DeckAction = 'up' | 'down' | 'rename' | 'delete'

/** Where keyboard focus goes after a deck action. A null deck means the file button. */
interface FocusRequest {
  deckId: string | null
  action: DeckAction
  /** The decks shown when the request was made. Focus is set again once newer decks arrive. */
  decks: SlideDeck[]
  /** True when no newer decks will come, so one try is enough. */
  once: boolean
}

// If the wanted button is disabled (a deck moved to the top, for example), try these instead.
const FOCUS_FALLBACK: Record<DeckAction, DeckAction[]> = {
  up: ['up', 'down', 'rename'],
  down: ['down', 'up', 'rename'],
  rename: ['rename'],
  delete: ['delete'],
}

function focusDeckButton(list: HTMLElement | null, deckId: string | null, action: DeckAction) {
  if (deckId === null) {
    document.querySelector<HTMLInputElement>('input[aria-label="Choose PDF file"]')?.focus()
    return
  }
  for (const a of FOCUS_FALLBACK[action]) {
    const button = list?.querySelector<HTMLButtonElement>(
      `button[data-deck="${CSS.escape(deckId)}"][data-action="${a}"]`,
    )
    if (button && !button.disabled) {
      button.focus()
      return
    }
  }
}

function DeckList({ decks }: { decks: SlideDeck[] }) {
  const [mode, setMode] = useState<DeckMode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const listRef = useRef<HTMLElement>(null)

  // Buttons are disabled while an action runs, which drops keyboard focus. Put it back on the
  // matching button, and again once the reloaded decks are shown.
  useEffect(() => {
    if (!focus || busy) return
    const active = document.activeElement
    const lost = !active || active === document.body || !!listRef.current?.contains(active)
    if (lost) focusDeckButton(listRef.current, focus.deckId, focus.action)
    if (focus.once || focus.decks !== decks) setFocus(null)
  }, [focus, busy, decks])

  if (decks.length === 0) {
    return (
      <div className="empty">
        <p>No slides yet.</p>
        <p className="muted">
          Import a PDF above to add your first deck. Export it from PowerPoint, Google Slides, Canva
          or Gamma.
        </p>
      </div>
    )
  }

  const starts = deckStarts(decks.map((d) => ({ slideCount: d.slides.length })))

  async function act(
    task: () => Promise<boolean>,
    focusAfter: { deckId: string | null; action: DeckAction },
  ) {
    const before = decks
    setBusy(true)
    let ok = false
    try {
      ok = await task()
    } finally {
      setBusy(false)
      setMode({ kind: 'idle' })
      setFocus({ ...focusAfter, decks: before, once: !ok })
    }
  }

  function changeMode(deckId: string, kind: DeckMode['kind']) {
    if (kind !== 'idle') {
      setMode({ kind, id: deckId })
      return
    }
    // Closing a rename or delete step puts focus back on the button that opened it.
    const action = mode.kind === 'idle' ? 'rename' : mode.kind
    setMode({ kind: 'idle' })
    setFocus({ deckId, action, decks, once: true })
  }

  /** After a delete, focus the next deck, or the one before, or the file button. */
  function neighbourOf(deckId: string): string | null {
    const i = decks.findIndex((d) => d.id === deckId)
    return (decks[i + 1] ?? decks[i - 1])?.id ?? null
  }

  const store = workshopStore.getState()

  return (
    <section ref={listRef} className="decks" aria-labelledby="decks-title">
      <h2 id="decks-title">Decks</h2>
      <p className="hint muted">
        Slides are numbered across all decks in this order. Moving or deleting a deck changes the
        numbers that [SLIDE n] cues point to.
      </p>
      <ol className="deck-list">
        {decks.map((deck, i) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            start={starts[i] ?? 1}
            first={i === 0}
            last={i === decks.length - 1}
            busy={busy}
            mode={mode.kind !== 'idle' && mode.id === deck.id ? mode.kind : 'idle'}
            onMode={(kind) => changeMode(deck.id, kind)}
            onMove={(delta) =>
              act(() => store.moveSlideDeck(deck.id, delta), {
                deckId: deck.id,
                action: delta < 0 ? 'up' : 'down',
              })
            }
            onRename={(name) =>
              act(() => store.renameSlideDeck(deck.id, name), { deckId: deck.id, action: 'rename' })
            }
            onDelete={() => {
              const next = neighbourOf(deck.id)
              void act(() => store.deleteSlideDeck(deck.id), { deckId: next, action: 'delete' })
            }}
          />
        ))}
      </ol>
    </section>
  )
}

function DeckCard({
  deck,
  start,
  first,
  last,
  busy,
  mode,
  onMode,
  onMove,
  onRename,
  onDelete,
}: {
  deck: SlideDeck
  start: number
  first: boolean
  last: boolean
  busy: boolean
  mode: 'idle' | 'rename' | 'delete'
  onMode: (mode: 'idle' | 'rename' | 'delete') => void
  onMove: (delta: number) => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(deck.name)
  const count = deck.slides.length

  function submitRename(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onRename(trimmed)
  }

  return (
    <li className="deck" data-testid="deck">
      <div className="deck-head">
        <h3 className="deck-name">{deck.name}</h3>
        <span className="deck-meta muted">
          {slideRangeLabel(start, count)} · {SOURCE_LABELS[deck.source]}
        </span>
        <div className="deck-actions">
          <button
            type="button"
            className="btn icon"
            aria-label={`Move ${deck.name} up`}
            data-deck={deck.id}
            data-action="up"
            disabled={busy || first}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn icon"
            aria-label={`Move ${deck.name} down`}
            data-deck={deck.id}
            data-action="down"
            disabled={busy || last}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn"
            aria-label={`Rename ${deck.name}`}
            data-deck={deck.id}
            data-action="rename"
            disabled={busy}
            onClick={() => {
              setName(deck.name)
              onMode('rename')
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn"
            aria-label={`Delete ${deck.name}`}
            data-deck={deck.id}
            data-action="delete"
            disabled={busy}
            onClick={() => onMode('delete')}
          >
            Delete
          </button>
        </div>
      </div>
      {mode === 'rename' && (
        <form
          className="inline-form"
          aria-label={`Rename deck ${deck.name}`}
          onSubmit={submitRename}
        >
          <input
            type="text"
            aria-label="Deck name"
            value={name}
            maxLength={LIMITS.maxTitleLength}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Only cancel here. Without this, Escape also stops all sound.
                e.preventDefault()
                onMode('idle')
              }
            }}
          />
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            Save deck name
          </button>
          <button type="button" className="btn" onClick={() => onMode('idle')}>
            Cancel
          </button>
        </form>
      )}
      {mode === 'delete' && (
        <div
          className="message error inline-form"
          role="group"
          aria-label={`Confirm delete deck ${deck.name}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Only cancel here. Without this, Escape also stops all sound.
              e.preventDefault()
              onMode('idle')
            }
          }}
        >
          <span>
            Delete "{deck.name}" and its {count === 1 ? 'slide' : `${count} slides`}? This cannot be
            undone.
          </span>
          <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
            Delete deck
          </button>
          <button type="button" className="btn" autoFocus onClick={() => onMode('idle')}>
            Cancel
          </button>
        </div>
      )}
      <Thumbnails deck={deck} start={start} />
    </li>
  )
}

function Thumbnails({ deck, start }: { deck: SlideDeck; start: number }) {
  const current = useAudienceStore((s) => (s.slide?.deckId === deck.id ? s.slide.index : null))
  const [urls, setUrls] = useState<string[]>([])
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set())
  const listRef = useRef<HTMLOListElement>(null)

  // Keep the current slide in view inside the strip when it changes, for example with the arrow
  // keys. Only the strip scrolls; the page stays where it is.
  useEffect(() => {
    const list = listRef.current
    if (current === null || !list) return
    const item = list.children[current]
    if (!(item instanceof HTMLElement)) return
    // The list is the offset parent (position: relative), so this is the place inside it.
    const left = item.offsetLeft
    const right = left + item.offsetWidth
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = right - list.clientWidth
    }
  }, [current])

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const made = deck.slides.map((blob) => URL.createObjectURL(blob))
    setUrls(made)
    setBroken(new Set())
    return () => made.forEach((u) => URL.revokeObjectURL(u))
  }, [deck.slides])

  return (
    <ol className="thumbs" ref={listRef} aria-label={`Slides in ${deck.name}`}>
      {deck.slides.map((_, i) => {
        const n = start + i
        const url = urls[i]
        return (
          <li
            key={i}
            className={current === i ? 'thumb current' : 'thumb'}
            data-testid="thumb"
            aria-current={current === i ? 'true' : undefined}
          >
            {url && !broken.has(i) ? (
              <img
                src={url}
                alt={`Slide ${n}`}
                loading="lazy"
                decoding="async"
                onError={() => setBroken((b) => new Set(b).add(i))}
              />
            ) : (
              <span className="thumb-missing" role="img" aria-label={`Slide ${n}`}>
                {url ? 'Cannot show' : ''}
              </span>
            )}
            <span className="thumb-number" aria-hidden="true">
              {n}
            </span>
            <button
              type="button"
              className="thumb-show"
              aria-label={`Show slide ${n}`}
              aria-pressed={current === i}
              onClick={() => audienceStore.getState().showSlide({ deckId: deck.id, index: i })}
            />
          </li>
        )
      })}
    </ol>
  )
}
