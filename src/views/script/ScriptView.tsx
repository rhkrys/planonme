import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { checkScript, findSound, lineOf, type CueContext, type CueProblem } from '../../cues/check'
import {
  applyOption,
  buildOptions,
  filterOptions,
  findCompletionQuery,
  type CueOption,
} from '../../cues/complete'
import { formatTimer, parseScript, type Cue, type Segment } from '../../cues/parse'
import { LIMITS } from '../../db/limits'
import type { MediaSummary } from '../../db/repo'
import type { Block, Workshop } from '../../db/types'
import { useWorkshopStore, workshopStore } from '../../store/workshopStore'
import { KIND_LABELS } from '../plan/timing'
import { caretPosition } from './caret'

const UNTITLED = 'Untitled block'
/** How long to wait after the last key press before saving. */
const SAVE_DELAY_MS = 500

function displayTitle(b: Block): string {
  return b.title.trim() || UNTITLED
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Saves one block's script, built from the latest stored blocks so no other change is lost. */
function saveScript(workshopId: string, blockId: string, script: string) {
  const current = workshopStore.getState().current
  if (!current || current.id !== workshopId) return
  const block = current.blocks.find((b) => b.id === blockId)
  if (!block || block.script === script) return
  void workshopStore.getState().updateCurrent({
    blocks: current.blocks.map((b) => (b.id === blockId ? { ...b, script } : b)),
  })
}

function toContext(media: MediaSummary | null): CueContext | null {
  if (!media) return null
  return {
    slideCount: media.decks.reduce((sum, d) => sum + d.slideCount, 0),
    sounds: media.sounds,
  }
}

/** The Script view: a list of blocks and the script editor for the chosen block. */
export function ScriptView() {
  const status = useWorkshopStore((s) => s.status)
  const current = useWorkshopStore((s) => s.current)
  const saving = useWorkshopStore((s) => s.pendingSaves > 0)
  const [dirty, setDirty] = useState(false)

  let body
  if (status === 'idle' || status === 'loading') {
    body = <p className="muted">Loading...</p>
  } else if (status === 'error') {
    body = (
      <p className="muted">The script can not be shown because saved workshops did not open.</p>
    )
  } else if (!current) {
    body = (
      <div className="empty">
        <p>No workshop yet.</p>
        <p className="muted">Use New at the top to create one.</p>
      </div>
    )
  } else if (current.blocks.length === 0) {
    body = (
      <div className="empty">
        <p>No blocks yet.</p>
        <p className="muted">Add blocks in Plan first. Each block gets its own script.</p>
      </div>
    )
  } else {
    body = <ScriptEditor key={current.id} workshop={current} onDirtyChange={setDirty} />
  }

  return (
    <section className="script-view">
      <div className="plan-head">
        <h1>Script</h1>
        {current && (
          <span className="save-state muted" data-testid="save-state">
            {saving || dirty ? 'Saving...' : 'All changes saved'}
          </span>
        )}
      </div>
      {body}
    </section>
  )
}

function ScriptEditor({
  workshop,
  onDirtyChange,
}: {
  workshop: Workshop
  onDirtyChange: (dirty: boolean) => void
}) {
  const media = useWorkshopStore((s) => s.media)
  const context = useMemo(() => toContext(media), [media])
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState<{ id: string; text: string } | null>(null)
  const selected = workshop.blocks.find((b) => b.id === chosenId) ?? workshop.blocks[0]

  // Problem counts per block, from the text being typed for the open block.
  const counts = useMemo(() => {
    const out = new Map<string, { cues: number; problems: number }>()
    for (const b of workshop.blocks) {
      const text = liveText && liveText.id === b.id ? liveText.text : b.script
      const parsed = parseScript(text)
      out.set(b.id, {
        cues: parsed.cues.length,
        problems: checkScript(parsed, context).length,
      })
    }
    return out
  }, [workshop.blocks, liveText, context])

  const onTextChange = useCallback((id: string, text: string) => setLiveText({ id, text }), [])

  if (!selected) return null

  return (
    <div className="script-layout">
      <nav className="script-blocks" aria-label="Script blocks">
        <ol>
          {workshop.blocks.map((b) => {
            const c = counts.get(b.id)
            const active = b.id === selected.id
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className={active ? 'script-block active' : 'script-block'}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setChosenId(b.id)}
                >
                  <span className="script-block-title">{displayTitle(b)}</span>
                  <span className="script-block-meta">
                    {KIND_LABELS[b.kind]}
                    {c && c.cues > 0 && `, ${plural(c.cues, 'cue', 'cues')}`}
                  </span>
                  {c && c.problems > 0 && (
                    <span className="script-block-problems">
                      {plural(c.problems, 'problem', 'problems')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <BlockScript
        key={selected.id}
        workshopId={workshop.id}
        block={selected}
        media={media}
        context={context}
        onDirtyChange={onDirtyChange}
        onTextChange={onTextChange}
      />
    </div>
  )
}

interface BlockScriptProps {
  workshopId: string
  block: Block
  media: MediaSummary | null
  context: CueContext | null
  onDirtyChange: (dirty: boolean) => void
  onTextChange: (id: string, text: string) => void
}

function BlockScript({
  workshopId,
  block,
  media,
  context,
  onDirtyChange,
  onTextChange,
}: BlockScriptProps) {
  // The editor owns the text while it is open. Saves happen shortly after typing stops.
  const [draft, setDraft] = useState(block.script)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [popupAt, setPopupAt] = useState({ x: 0, y: 0 })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsaved = useRef<string | null>(null)
  const baseId = useId()
  const textareaId = `${baseId}-text`
  const listId = `${baseId}-list`
  const helpId = `${baseId}-help`
  const name = displayTitle(block)

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (unsaved.current !== null) {
      const text = unsaved.current
      unsaved.current = null
      saveScript(workshopId, block.id, text)
    }
    onDirtyChange(false)
  }, [workshopId, block.id, onDirtyChange])

  // Save what is left when switching blocks or views, and before the page goes away.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (unsaved.current !== null) {
        flush()
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [flush])

  useLayoutEffect(() => {
    const at = pendingCaret.current
    const el = textareaRef.current
    if (at === null || !el) return
    pendingCaret.current = null
    el.focus()
    el.setSelectionRange(at, at)
  })

  const allOptions = useMemo(() => buildOptions(media ?? { decks: [], sounds: [] }), [media])
  const query = open ? findCompletionQuery(draft, caret) : null
  const queryText = query?.query ?? null
  const options = useMemo(
    () => (queryText === null ? [] : filterOptions(allOptions, queryText)),
    [allOptions, queryText],
  )
  const showList = open && query !== null && options.length > 0
  const activeIndex = options.length > 0 ? Math.min(active, options.length - 1) : 0
  const activeOption = showList ? options[activeIndex] : undefined
  const optionId = (o: CueOption) => `${baseId}-opt-${o.id}`

  useEffect(() => {
    if (!activeOption) return
    const el = document.getElementById(optionId(activeOption))
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  const parsed = useMemo(() => parseScript(draft), [draft])
  const problems = useMemo(() => checkScript(parsed, context), [parsed, context])

  function change(text: string, at: number) {
    setDraft(text)
    setCaret(at)
    onTextChange(block.id, text)
    unsaved.current = text
    onDirtyChange(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  function openList(at: number) {
    setOpen(true)
    setActive(0)
    const el = textareaRef.current
    if (el) setPopupAt(caretPosition(el, at))
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    const at = e.target.selectionStart ?? text.length
    const typedBracket = text.length > draft.length && text[at - 1] === '['
    change(text, at)
    if (typedBracket) openList(at)
    else if (open && findCompletionQuery(text, at) === null) setOpen(false)
  }

  function choose(option: CueOption) {
    if (!query) return
    const result = applyOption(draft, query, caret, option)
    if (result.text.length > LIMITS.maxScriptLength) {
      setOpen(false)
      return
    }
    change(result.text, result.caret)
    pendingCaret.current = result.caret
    setActive(0)
    if (result.done) setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!showList) {
      if (e.key === ' ' && e.ctrlKey) {
        const at = e.currentTarget.selectionStart ?? 0
        if (findCompletionQuery(draft, at)) {
          e.preventDefault()
          setCaret(at)
          openList(at)
        }
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((activeIndex + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((activeIndex - 1 + options.length) % options.length)
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault()
      setActive(options.length - 1)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeOption) {
        e.preventDefault()
        choose(activeOption)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  function onSelect() {
    const el = textareaRef.current
    if (!el) return
    const at = el.selectionStart ?? 0
    if (at !== caret) setCaret(at)
    if (open && (el.selectionStart !== el.selectionEnd || !findCompletionQuery(el.value, at))) {
      setOpen(false)
    }
  }

  function showProblem(p: CueProblem) {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(p.start, p.end)
    setCaret(p.start)
    setOpen(false)
  }

  return (
    <div className="script-editor">
      <div className="script-editor-head">
        <h2>{name}</h2>
        <span className="muted">
          {KIND_LABELS[block.kind]}, {block.durationMin} min
        </span>
      </div>
      {block.goal.trim() && <p className="script-goal muted">Goal: {block.goal}</p>}
      <div className="script-panes">
        <div className="field script-input">
          <label htmlFor={textareaId}>Script for {name}</label>
          <div className="script-input-wrap">
            <textarea
              id={textareaId}
              ref={textareaRef}
              className="script-text"
              value={draft}
              rows={16}
              maxLength={LIMITS.maxScriptLength}
              spellCheck
              aria-describedby={helpId}
              aria-autocomplete="list"
              aria-controls={showList ? listId : undefined}
              aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onSelect={onSelect}
              onClick={onSelect}
              onBlur={() => {
                setOpen(false)
                flush()
              }}
            />
            {showList && (
              <ul
                id={listId}
                className="cue-suggestions"
                role="listbox"
                aria-label="Cue suggestions"
                style={{ left: popupAt.x, top: popupAt.y }}
              >
                {options.map((o, i) => (
                  <li
                    key={o.id}
                    id={optionId(o)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={i === activeIndex ? 'cue-option active' : 'cue-option'}
                    // Keep focus in the textarea while picking with the mouse.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                  >
                    <span className="cue-option-label">{o.label}</span>
                    <span className="cue-option-detail">{o.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p id={helpId} className="hint muted">
            Type [ to add a cue: [SLIDE 3], [SFX applause], [MUSIC intro], [STOP MUSIC], [TIMER 5m].
            Use the arrow keys and Enter to pick.
          </p>
        </div>
        <div className="script-side">
          <h3 id={`${baseId}-preview`}>Preview</h3>
          <div
            className="script-preview"
            role="region"
            aria-labelledby={`${baseId}-preview`}
            data-testid="script-preview"
          >
            {draft.trim() === '' ? (
              <p className="muted">Nothing written yet.</p>
            ) : (
              <Preview segments={parsed.segments} problems={problems} media={media} />
            )}
          </div>
          <Problems
            text={draft}
            problems={problems}
            checked={context !== null}
            onShow={showProblem}
          />
        </div>
      </div>
    </div>
  )
}

function slideLabel(slide: number, media: MediaSummary | null): string {
  if (!media) return `Slide ${slide}`
  let left = slide
  for (const d of media.decks) {
    if (left <= d.slideCount) return `Slide ${slide}: ${d.name}, slide ${left}`
    left -= d.slideCount
  }
  return `Slide ${slide}`
}

function describeCue(cue: Cue, media: MediaSummary | null): string {
  switch (cue.type) {
    case 'slide':
      return slideLabel(cue.slide, media)
    case 'sfx':
    case 'music': {
      const sound = media ? findSound(media.sounds, cue.name) : null
      const what = cue.type === 'sfx' ? 'Sound effect' : 'Music'
      return `${what}: ${sound?.name ?? cue.name}`
    }
    case 'stopMusic':
      return 'Stop the music'
    case 'timer':
      return `Timer: ${formatTimer(cue.seconds)}`
  }
}

const CUE_CLASS: Record<Cue['type'], string> = {
  slide: 'cue-slide',
  sfx: 'cue-sfx',
  music: 'cue-music',
  stopMusic: 'cue-music',
  timer: 'cue-timer',
}

function Preview({
  segments,
  problems,
  media,
}: {
  segments: Segment[]
  problems: CueProblem[]
  media: MediaSummary | null
}) {
  const bad = new Map(problems.map((p) => [p.start, p.message]))
  return (
    <p className="script-preview-text">
      {segments.map((seg) => {
        if (seg.kind === 'text') return <span key={seg.start}>{seg.text}</span>
        const problem = bad.get(seg.start)
        const kindClass = seg.kind === 'cue' ? CUE_CLASS[seg.cue.type] : ''
        const title = problem ?? (seg.kind === 'cue' ? describeCue(seg.cue, media) : seg.message)
        return (
          <mark
            key={seg.start}
            className={['cue', kindClass, problem ? 'bad' : ''].filter(Boolean).join(' ')}
            title={title}
            data-testid={problem ? 'cue-bad' : 'cue'}
          >
            {seg.raw}
          </mark>
        )
      })}
    </p>
  )
}

function Problems({
  text,
  problems,
  checked,
  onShow,
}: {
  text: string
  problems: CueProblem[]
  checked: boolean
  onShow: (p: CueProblem) => void
}) {
  return (
    <div className="script-problems">
      <h3>Problems</h3>
      {!checked && (
        <p className="message warn">
          Slides and sounds could not be read, so slide and sound cues are not checked.
        </p>
      )}
      {problems.length === 0 ? (
        <p className="muted">No problems found.</p>
      ) : (
        <ul aria-label="Cue problems">
          {problems.map((p) => {
            const line = lineOf(text, p.start)
            return (
              <li key={p.start}>
                <button
                  type="button"
                  className="problem"
                  aria-label={`Line ${line}: ${p.raw}. ${p.message} Show in script.`}
                  onClick={() => onShow(p)}
                >
                  <span className="problem-where">
                    Line {line}: <code>{p.raw}</code>
                  </span>
                  <span className="problem-message">{p.message}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
