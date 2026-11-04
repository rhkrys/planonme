import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { newId } from '../../db/ids'
import { DATE_PATTERN, LIMITS } from '../../db/limits'
import { BLOCK_KINDS, type Block, type BlockKind, type Workshop } from '../../db/types'
import { useWorkshopStore, workshopStore } from '../../store/workshopStore'
import {
  computeSchedule,
  formatDuration,
  formatOffset,
  KIND_LABELS,
  MAX_BLOCK_MINUTES,
  MAX_SESSION_MINUTES,
  moveItem,
  parseMinutes,
  type Schedule,
} from './timing'

const UNTITLED = 'Untitled block'

function displayTitle(b: Block): string {
  return b.title.trim() || UNTITLED
}

function isKind(v: string): v is BlockKind {
  return (BLOCK_KINDS as readonly string[]).includes(v)
}

/** Saves new blocks, built from the latest stored blocks so no change is lost. */
function saveBlocks(change: (blocks: Block[]) => Block[]) {
  const current = workshopStore.getState().current
  if (!current) return
  void workshopStore.getState().updateCurrent({ blocks: change(current.blocks) })
}

/** Local text for an input, reset whenever the stored value changes. */
function useDraft(stored: string) {
  const [draft, setDraft] = useState(stored)
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    setSeen(stored)
    setDraft(stored)
  }
  return [draft, setDraft] as const
}

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

/** The Plan view: workshop settings and the list of blocks with timing. */
export function PlanView() {
  const status = useWorkshopStore((s) => s.status)
  const current = useWorkshopStore((s) => s.current)
  const saving = useWorkshopStore((s) => s.pendingSaves > 0)

  let body
  if (status === 'idle' || status === 'loading') {
    body = <p className="muted">Loading...</p>
  } else if (status === 'error') {
    body = <p className="muted">The plan can not be shown because saved workshops did not open.</p>
  } else if (!current) {
    body = (
      <div className="empty">
        <p>No workshop yet.</p>
        <p className="muted">Use New at the top to create one.</p>
      </div>
    )
  } else {
    // A new key per workshop resets edit forms and drafts when the workshop changes.
    body = <Planner key={current.id} workshop={current} />
  }

  return (
    <section className="plan">
      <div className="plan-head">
        <h1>Plan</h1>
        {current && (
          <span className="save-state muted" data-testid="save-state">
            {saving ? 'Saving...' : 'All changes saved'}
          </span>
        )}
      </div>
      {body}
    </section>
  )
}

function Planner({ workshop }: { workshop: Workshop }) {
  const schedule = computeSchedule(workshop.blocks, workshop.durationMin)
  return (
    <>
      <Settings workshop={workshop} />
      <TimeSummary schedule={schedule} />
      <BlockList blocks={workshop.blocks} schedule={schedule} />
      <AddBlockForm count={workshop.blocks.length} />
    </>
  )
}

function Settings({ workshop }: { workshop: Workshop }) {
  const [title, setTitle] = useDraft(workshop.title)
  const [date, setDate] = useDraft(workshop.date)
  const [minutes, setMinutes] = useDraft(String(workshop.durationMin))
  const [titleError, setTitleError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [minutesError, setMinutesError] = useState<string | null>(null)
  const update = useWorkshopStore((s) => s.updateCurrent)

  function commitTitle() {
    const t = title.trim()
    if (!t) {
      setTitleError('Enter a workshop title.')
      return
    }
    setTitleError(null)
    if (t !== workshop.title) void update({ title: t.slice(0, LIMITS.maxTitleLength) })
    else setTitle(workshop.title)
  }

  function commitDate(value: string) {
    setDate(value)
    if (value !== '' && !DATE_PATTERN.test(value)) {
      setDateError('Pick a date, or leave it empty.')
      return
    }
    setDateError(null)
    if (value !== workshop.date) void update({ date: value })
  }

  function commitMinutes() {
    const parsed = parseMinutes(minutes, MAX_SESSION_MINUTES, { allowEmpty: true })
    if (!parsed.ok) {
      setMinutesError(parsed.error)
      return
    }
    setMinutesError(null)
    if (parsed.value !== workshop.durationMin) void update({ durationMin: parsed.value })
    else setMinutes(String(workshop.durationMin))
  }

  return (
    <fieldset className="settings">
      <legend>Workshop</legend>
      <div className="field">
        <label htmlFor="plan-title">Workshop title</label>
        <input
          id="plan-title"
          type="text"
          value={title}
          maxLength={LIMITS.maxTitleLength}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'plan-title-error' : undefined}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={commitOnEnter}
        />
        {titleError && (
          <p id="plan-title-error" className="field-error">
            {titleError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="plan-date">Date</label>
        <input
          id="plan-date"
          type="date"
          value={date}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? 'plan-date-error' : undefined}
          onChange={(e) => commitDate(e.target.value)}
        />
        {dateError && (
          <p id="plan-date-error" className="field-error">
            {dateError}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="plan-length">Session length (minutes)</label>
        <input
          id="plan-length"
          type="text"
          inputMode="numeric"
          className="minutes"
          value={minutes}
          maxLength={6}
          aria-invalid={minutesError ? true : undefined}
          aria-describedby={minutesError ? 'plan-length-error' : undefined}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={commitMinutes}
          onKeyDown={commitOnEnter}
        />
        {minutesError && (
          <p id="plan-length-error" className="field-error">
            {minutesError}
          </p>
        )}
      </div>
    </fieldset>
  )
}

function TimeSummary({ schedule }: { schedule: Schedule }) {
  const { totalMin, sessionMin, hasSession, remainingMin, overMin, isOver } = schedule
  const fill = hasSession ? Math.min(100, (totalMin / sessionMin) * 100) : 0
  return (
    <div className="time-summary" aria-live="polite">
      <p className="time-total">
        {hasSession
          ? `Planned ${formatDuration(totalMin)} of ${formatDuration(sessionMin)}`
          : `Planned ${formatDuration(totalMin)}`}
      </p>
      {hasSession && (
        <div className={isOver ? 'meter over' : 'meter'} aria-hidden="true">
          <div className="meter-fill" style={{ width: `${fill}%` }} />
        </div>
      )}
      {!hasSession ? (
        <p className="muted">Set a session length to see the time left.</p>
      ) : isOver ? (
        <p className="message warn">
          Over time by {formatDuration(overMin)}. Shorten or remove blocks, or make the session
          longer.
        </p>
      ) : (
        <p className="time-left">{formatDuration(remainingMin)} left</p>
      )}
    </div>
  )
}

type Focus = { id: string; action: 'up' | 'down' | 'edit' }

function BlockList({ blocks, schedule }: { blocks: Block[]; schedule: Schedule }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const [focus, setFocus] = useState<Focus | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  // After a keyboard move or an edit, put focus back on the block's matching button, so
  // keyboard users keep their place. A move button at the top or bottom is disabled, so fall
  // back to another button of the same block.
  useEffect(() => {
    if (!focus || !listRef.current) return
    const buttons = Array.from(
      listRef.current.querySelectorAll<HTMLButtonElement>('button[data-action]'),
    )
    const mine = buttons.filter((b) => b.dataset.block === focus.id)
    const target =
      mine.find((b) => b.dataset.action === focus.action && !b.disabled) ??
      mine.find((b) => !b.disabled)
    target?.focus()
    setFocus(null)
  }, [focus])

  function move(id: string, to: number, how: 'keyboard' | 'drag') {
    const from = blocks.findIndex((b) => b.id === id)
    const block = blocks[from]
    if (!block || to < 0 || to >= blocks.length || from === to) return
    saveBlocks((list) => {
      const i = list.findIndex((b) => b.id === id)
      return i < 0 ? list : moveItem(list, i, Math.min(to, list.length - 1))
    })
    setAnnounce(`Moved ${displayTitle(block)} to position ${to + 1} of ${blocks.length}.`)
    if (how === 'keyboard') setFocus({ id, action: to < from ? 'up' : 'down' })
  }

  function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault()
    const id = dragId ?? e.dataTransfer.getData('text/plain')
    setDragId(null)
    setOverId(null)
    if (!id || id === targetId) return
    const to = blocks.findIndex((b) => b.id === targetId)
    if (to >= 0) move(id, to, 'drag')
  }

  if (blocks.length === 0) {
    return (
      <div className="empty">
        <p>No blocks yet.</p>
        <p className="muted">
          Add the first block below: a talk, an exercise, a break or a discussion.
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="muted hint">Drag blocks to reorder them, or use the arrow buttons.</p>
      <ol className="blocks" aria-label="Blocks" ref={listRef}>
        {blocks.map((b, i) => {
          const row = schedule.rows[i]
          const name = displayTitle(b)
          if (editingId === b.id) {
            return (
              <li key={b.id} className="block editing">
                <BlockEditor
                  block={b}
                  onDone={() => {
                    setEditingId(null)
                    setFocus({ id: b.id, action: 'edit' })
                  }}
                />
              </li>
            )
          }
          const classes = ['block', `kind-${b.kind}`]
          if (row?.pastEnd) classes.push('past-end')
          if (overId === b.id && dragId !== b.id) classes.push('drop-target')
          if (dragId === b.id) classes.push('dragging')
          return (
            <li
              key={b.id}
              className={classes.join(' ')}
              draggable={deletingId !== b.id}
              data-testid="block-row"
              onDragStart={(e) => {
                setDragId(b.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', b.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (overId !== b.id) setOverId(b.id)
              }}
              onDragLeave={() => {
                if (overId === b.id) setOverId(null)
              }}
              onDrop={(e) => onDrop(e, b.id)}
            >
              <span className="grip" aria-hidden="true">
                ::
              </span>
              <span className="block-start">
                <span className="visually-hidden">Starts at </span>
                {formatOffset(row?.startMin ?? 0)}
              </span>
              <div className="block-main">
                <div className="block-head">
                  <span className="block-title">{name}</span>
                  <span className="kind-badge">{KIND_LABELS[b.kind]}</span>
                  <span className="block-length">{formatDuration(b.durationMin)}</span>
                  {row?.pastEnd && <span className="past-end-badge">Past session end</span>}
                </div>
                {b.goal && <p className="block-goal">Goal: {b.goal}</p>}
                {b.notes && <p className="block-notes muted">{b.notes}</p>}
                {deletingId === b.id && (
                  <div
                    className="inline-form"
                    role="group"
                    aria-label={`Confirm delete block ${name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setDeletingId(null)
                    }}
                  >
                    <span>Delete "{name}" with its notes and script?</span>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        const neighbour = blocks[i + 1] ?? blocks[i - 1]
                        setDeletingId(null)
                        saveBlocks((list) => list.filter((x) => x.id !== b.id))
                        setAnnounce(`Deleted ${name}.`)
                        if (neighbour) setFocus({ id: neighbour.id, action: 'edit' })
                      }}
                    >
                      Delete block
                    </button>
                    <button
                      type="button"
                      className="btn"
                      autoFocus
                      onClick={() => setDeletingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div className="block-actions">
                <button
                  type="button"
                  className="btn icon"
                  aria-label={`Move ${name} up`}
                  data-action="up"
                  data-block={b.id}
                  disabled={i === 0}
                  onClick={() => move(b.id, i - 1, 'keyboard')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn icon"
                  aria-label={`Move ${name} down`}
                  data-action="down"
                  data-block={b.id}
                  disabled={i === blocks.length - 1}
                  onClick={() => move(b.id, i + 1, 'keyboard')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Edit ${name}`}
                  data-action="edit"
                  data-block={b.id}
                  onClick={() => {
                    setDeletingId(null)
                    setEditingId(b.id)
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Delete ${name}`}
                  onClick={() => setDeletingId(b.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </>
  )
}

function BlockEditor({ block, onDone }: { block: Block; onDone: () => void }) {
  const [title, setTitle] = useState(block.title)
  const [kind, setKind] = useState<BlockKind>(block.kind)
  const [minutes, setMinutes] = useState(String(block.durationMin))
  const [goal, setGoal] = useState(block.goal)
  const [notes, setNotes] = useState(block.notes)
  const [error, setError] = useState<string | null>(null)
  const prefix = `edit-${block.id}`

  function save() {
    const parsed = parseMinutes(minutes, MAX_BLOCK_MINUTES)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const changes = {
      title: title.trim().slice(0, LIMITS.maxTitleLength),
      kind,
      durationMin: parsed.value,
      goal: goal.slice(0, LIMITS.maxGoalLength),
      notes: notes.slice(0, LIMITS.maxNotesLength),
    }
    saveBlocks((list) => list.map((b) => (b.id === block.id ? { ...b, ...changes } : b)))
    onDone()
  }

  return (
    <form
      className="block-form"
      aria-label={`Edit block ${displayTitle(block)}`}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone()
      }}
    >
      <div className="field wide">
        <label htmlFor={`${prefix}-title`}>Block title</label>
        <input
          id={`${prefix}-title`}
          type="text"
          value={title}
          autoFocus
          maxLength={LIMITS.maxTitleLength}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-kind`}>Block kind</label>
        <select
          id={`${prefix}-kind`}
          value={kind}
          onChange={(e) => {
            if (isKind(e.target.value)) setKind(e.target.value)
          }}
        >
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-minutes`}>Block minutes</label>
        <input
          id={`${prefix}-minutes`}
          type="text"
          inputMode="numeric"
          className="minutes"
          value={minutes}
          maxLength={6}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${prefix}-error` : undefined}
          onChange={(e) => setMinutes(e.target.value)}
        />
        {error && (
          <p id={`${prefix}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
      <div className="field wide">
        <label htmlFor={`${prefix}-goal`}>Block goal</label>
        <textarea
          id={`${prefix}-goal`}
          rows={2}
          value={goal}
          maxLength={LIMITS.maxGoalLength}
          onChange={(e) => setGoal(e.target.value)}
        />
      </div>
      <div className="field wide">
        <label htmlFor={`${prefix}-notes`}>Block notes</label>
        <textarea
          id={`${prefix}-notes`}
          rows={3}
          value={notes}
          maxLength={LIMITS.maxNotesLength}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="inline-form wide">
        <button type="submit" className="btn primary">
          Save block
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AddBlockForm({ count }: { count: number }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<BlockKind>('talk')
  const [minutes, setMinutes] = useState('10')
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const full = count >= LIMITS.maxBlocks

  function add() {
    const t = title.trim()
    if (!t) {
      setError('Enter a block title.')
      return
    }
    const parsed = parseMinutes(minutes, MAX_BLOCK_MINUTES)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    const block: Block = {
      id: newId(),
      title: t.slice(0, LIMITS.maxTitleLength),
      kind,
      durationMin: parsed.value,
      goal: '',
      notes: '',
      script: '',
    }
    saveBlocks((list) => (list.length >= LIMITS.maxBlocks ? list : [...list, block]))
    setTitle('')
    titleRef.current?.focus()
  }

  return (
    <form
      className="add-block"
      aria-label="Add block"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <h2>Add a block</h2>
      <div className="add-row">
        <div className="field wide">
          <label htmlFor="new-block-title">New block title</label>
          <input
            id="new-block-title"
            ref={titleRef}
            type="text"
            value={title}
            maxLength={LIMITS.maxTitleLength}
            disabled={full}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'new-block-error' : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-block-kind">New block kind</label>
          <select
            id="new-block-kind"
            value={kind}
            disabled={full}
            onChange={(e) => {
              if (isKind(e.target.value)) setKind(e.target.value)
            }}
          >
            {BLOCK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-block-minutes">New block minutes</label>
          <input
            id="new-block-minutes"
            type="text"
            inputMode="numeric"
            className="minutes"
            value={minutes}
            maxLength={6}
            disabled={full}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'new-block-error' : undefined}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={full}>
          Add block
        </button>
      </div>
      {error && (
        <p id="new-block-error" className="field-error">
          {error}
        </p>
      )}
      {full && <p className="muted">A workshop can have at most {LIMITS.maxBlocks} blocks.</p>}
    </form>
  )
}
