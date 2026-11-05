import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { audioEngine } from '../../audio/engine'
import { AudiencePanel, AudiencePreview } from '../../components/AudiencePanel'
import { describeCue } from '../../cues/describe'
import type { MediaSummary } from '../../db/repo'
import type { SlideDeck } from '../../db/types'
import {
  describeDelta,
  elapsedMs,
  formatClock,
  isFresh,
  scheduleDelta,
  timerLeft,
} from '../../run/clock'
import {
  FONT_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  planFor,
  runStore,
  useRunStore,
} from '../../run/runStore'
import {
  clampPosition,
  currentCue,
  nextCue,
  nextSlideCue,
  type Position,
  type RunBlock,
  type RunCue,
  type RunPlan,
} from '../../run/sequencer'
import { useRunKeys } from '../../run/useRunKeys'
import { slideAt } from '../../slides/decks'
import { useSlideDecks } from '../../slides/useSlideDecks'
import { useAudienceStore } from '../../store/audienceStore'
import { useWorkshopStore } from '../../store/workshopStore'
import { computeSchedule, formatDuration, formatOffset, KIND_LABELS } from '../plan/timing'

const UNTITLED = 'Untitled block'

/** The current time, updated a few times a second while active. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [active])
  return active ? now : Date.now()
}

export function RunView({ onOpenPreflight }: { onOpenPreflight?: () => void } = {}) {
  const status = useWorkshopStore((s) => s.status)
  const currentId = useWorkshopStore((s) => s.currentId)
  const blocks = useWorkshopStore((s) => s.current?.blocks)
  const media = useWorkshopStore((s) => s.media)
  const runWorkshop = useRunStore((s) => s.workshopId)

  useEffect(() => {
    runStore.getState().syncWorkshop(currentId)
  }, [currentId])

  useRunKeys()

  // currentPlan reads the same blocks and media from the store, and caches the result.
  const plan = useMemo(() => planFor(blocks, media), [blocks, media])

  if (status !== 'ready' || !currentId) {
    return (
      <section className="run-view">
        <h1>Run</h1>
        <p className="muted">{status === 'error' ? 'No workshop is open.' : 'Loading...'}</p>
      </section>
    )
  }

  return (
    <section className="run-view">
      <h1>Run</h1>
      {onOpenPreflight && (
        <p className="run-preflight muted">
          Going live in Zoom? Check everything first.{' '}
          <button type="button" className="btn" onClick={onOpenPreflight}>
            Open pre-flight checklist
          </button>
        </p>
      )}
      {plan.blocks.length === 0 ? (
        <p className="muted">This workshop has no blocks yet. Add them in Plan.</p>
      ) : runWorkshop === currentId ? (
        <Runner plan={plan} media={media} />
      ) : (
        <p className="muted">Loading...</p>
      )}
    </section>
  )
}

function Runner({ plan, media }: { plan: RunPlan; media: MediaSummary | null }) {
  const rawPos = useRunStore((s) => s.pos)
  const clock = useRunStore((s) => s.clock)
  const timer = useRunStore((s) => s.timer)
  const note = useRunStore((s) => s.note)
  const fontSize = useRunStore((s) => s.fontSize)
  const durationMin = useWorkshopStore((s) => s.current?.durationMin ?? 0)
  const engine = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)
  const { decks, failed } = useSlideDecks()
  const store = runStore.getState()

  const pos = clampPosition(plan, rawPos)
  const now = useNow(clock.running || timer !== null)
  const current = currentCue(plan, pos)
  const next = nextCue(plan, pos)

  return (
    <>
      <div className="run-bar">
        <SessionClocks plan={plan} pos={pos} durationMin={durationMin} now={now} />
        <div className="inline-form" role="group" aria-label="Session">
          {clock.running ? (
            <button type="button" className="btn" onClick={() => store.pauseSession()}>
              Pause session
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => store.startSession()}>
              {isFresh(clock) ? 'Start session' : 'Resume session'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => store.resetSession()}>
            Reset session
          </button>
          <AudienceStatus />
        </div>
        <div className="inline-form" role="group" aria-label="Cues">
          <button
            type="button"
            className="btn primary run-go"
            aria-label="GO"
            aria-keyshortcuts="Space"
            onClick={() => store.go()}
          >
            GO <kbd>Space</kbd>
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Back"
            aria-keyshortcuts="Shift+Space"
            onClick={() => store.back()}
          >
            Back <kbd>Shift+Space</kbd>
          </button>
          <button
            type="button"
            className="btn"
            disabled={pos.block >= plan.blocks.length - 1}
            onClick={() => store.jumpToBlock(pos.block + 1)}
          >
            Next block
          </button>
          <span className="run-size" role="group" aria-label="Text size">
            <button
              type="button"
              className="btn"
              aria-label="Smaller text"
              disabled={fontSize <= MIN_FONT_SIZE}
              onClick={() => store.setFontSize(fontSize - FONT_STEP)}
            >
              A-
            </button>
            <span className="muted" data-testid="run-font-size">
              {fontSize} px
            </span>
            <button
              type="button"
              className="btn"
              aria-label="Larger text"
              disabled={fontSize >= MAX_FONT_SIZE}
              onClick={() => store.setFontSize(fontSize + FONT_STEP)}
            >
              A+
            </button>
          </span>
        </div>
      </div>

      <div aria-live="polite" className="run-messages">
        {note && (
          <div className="message warn" data-testid="run-note">
            <span>{note}</span>
            <button
              type="button"
              className="btn"
              aria-label="Dismiss note"
              onClick={() => store.clearNote()}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      {engine.error && (
        <div className="message error" role="alert">
          <span>{engine.error}</span>
          <button
            type="button"
            className="btn"
            aria-label="Dismiss sound problem"
            onClick={() => audioEngine.clearError()}
          >
            Dismiss
          </button>
        </div>
      )}
      {failed && (
        <p className="message error" role="alert">
          Could not read the slides. Reload the page to try again.
        </p>
      )}

      <div className="run-layout">
        <Teleprompter
          plan={plan}
          pos={pos}
          current={current}
          next={next}
          media={media}
          fontSize={fontSize}
        />
        <aside className="run-side">
          {timer && <TimerPanel left={timerLeft(timer, now)} total={timer.seconds} />}
          <NextUp plan={plan} pos={pos} next={next} media={media} decks={decks} />
          <AudiencePanel decks={decks} thumbnails={false} />
        </aside>
      </div>
    </>
  )
}

function SessionClocks({
  plan,
  pos,
  durationMin,
  now,
}: {
  plan: RunPlan
  pos: Position
  durationMin: number
  now: number
}) {
  const clock = useRunStore((s) => s.clock)
  const blockStartMs = useRunStore((s) => s.blockStartMs)
  const schedule = useMemo(() => computeSchedule(plan.blocks, durationMin), [plan, durationMin])
  const row = schedule.rows[pos.block]
  const block = plan.blocks[pos.block]
  const elapsedSec = elapsedMs(clock, now) / 1000
  const blockStartSec = Math.min(blockStartMs / 1000, elapsedSec)
  const plannedSec = row ? (row.endMin - row.startMin) * 60 : 0
  const blockLeft = plannedSec - (elapsedSec - blockStartSec)
  const fresh = isFresh(clock)
  const delta = describeDelta(
    scheduleDelta({
      blockStartSec,
      elapsedSec,
      plannedStartSec: (row?.startMin ?? 0) * 60,
      plannedSec,
    }),
  )

  return (
    <div className="run-clocks">
      <div className="run-clock">
        <span className="run-clock-label">
          {block ? `Block left: ${blockName(block)}` : 'Block'}
        </span>
        <span
          className={blockLeft < 0 ? 'run-clock-value over' : 'run-clock-value'}
          role="timer"
          aria-label="Block time left"
          data-testid="block-countdown"
        >
          {blockLeft < 0 ? `${formatClock(-blockLeft)} over` : formatClock(blockLeft)}
        </span>
      </div>
      <div className="run-clock">
        <span className="run-clock-label">
          Elapsed{fresh ? '' : clock.running ? '' : ' (paused)'}
        </span>
        <span
          className="run-clock-value"
          role="timer"
          aria-label="Total elapsed"
          data-testid="elapsed"
        >
          {formatClock(elapsedSec)}
        </span>
      </div>
      <div className="run-clock">
        <span className="run-clock-label">Schedule</span>
        <span
          className={`run-clock-value schedule-${fresh ? 'idle' : delta.state}`}
          data-testid="schedule-status"
        >
          {fresh ? 'Not started' : delta.label}
        </span>
      </div>
    </div>
  )
}

function AudienceStatus() {
  const connected = useAudienceStore((s) => s.connected)
  return (
    <span className={connected ? 'connection on' : 'connection'} data-testid="run-connection">
      <span className="connection-dot" aria-hidden="true" />
      {connected ? 'Audience window connected' : 'Audience window not open'}
    </span>
  )
}

function blockName(block: RunBlock): string {
  return block.title.trim() || UNTITLED
}

// Memoized: the clocks re-render the view a few times a second, and scripts can be long.
const Teleprompter = memo(function Teleprompter({
  plan,
  pos,
  current,
  next,
  media,
  fontSize,
}: {
  plan: RunPlan
  pos: Position
  current: RunCue | null
  next: RunCue | null
  media: MediaSummary | null
  fontSize: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const schedule = useMemo(() => computeSchedule(plan.blocks, 0), [plan])

  // Keep the current cue (or the start of the running block) in view.
  const target = current
    ? `[data-cue-index="${current.index}"]`
    : `[data-block-index="${pos.block}"]`
  useEffect(() => {
    const box = ref.current
    const el = box?.querySelector(target)
    if (!box || !(el instanceof HTMLElement)) return
    // Scroll only the teleprompter, so the clocks and buttons above stay where they are.
    const offset = el.getBoundingClientRect().top - box.getBoundingClientRect().top
    const top = box.scrollTop + offset - box.clientHeight / 3
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof box.scrollTo === 'function') {
      box.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
    } else {
      box.scrollTop = Math.max(0, top)
    }
  }, [target, fontSize])

  return (
    <div
      ref={ref}
      className="teleprompter"
      role="region"
      aria-label="Teleprompter"
      tabIndex={0}
      style={{ fontSize: `${fontSize}px` }}
    >
      {plan.blocks.map((block, i) => {
        const running = i === pos.block
        const row = schedule.rows[i]
        const name = blockName(block)
        return (
          <section
            key={block.id}
            className={running ? 'run-block running' : 'run-block'}
            data-block-index={i}
            aria-labelledby={`run-block-${i}`}
          >
            <div className="run-block-head">
              <h2 id={`run-block-${i}`}>{name}</h2>
              <span className="run-block-meta muted">
                {KIND_LABELS[block.kind] ?? ''}, {formatDuration(block.durationMin)}, starts at{' '}
                {formatOffset(row?.startMin ?? 0)}
              </span>
              {running && <span className="run-now">Now</span>}
              <button
                type="button"
                className="btn"
                aria-label={`Start block ${name}`}
                onClick={() => runStore.getState().jumpToBlock(i)}
              >
                Start here
              </button>
            </div>
            {block.script.trim() === '' ? (
              <p className="muted run-empty">No script for this block.</p>
            ) : (
              <ScriptText
                block={block}
                plan={plan}
                current={current}
                next={next}
                lastFired={pos.cue}
                media={media}
              />
            )}
          </section>
        )
      })}
    </div>
  )
})

const CUE_CLASS = {
  slide: 'cue-slide',
  sfx: 'cue-sfx',
  music: 'cue-music',
  stopMusic: 'cue-music',
  timer: 'cue-timer',
} as const

function ScriptText({
  block,
  plan,
  current,
  next,
  lastFired,
  media,
}: {
  block: RunBlock
  plan: RunPlan
  current: RunCue | null
  next: RunCue | null
  lastFired: number
  media: MediaSummary | null
}) {
  const byStart = new Map<number, RunCue>()
  for (let i = block.firstCue; i < block.firstCue + block.cueCount; i++) {
    const c = plan.cues[i]
    if (c) byStart.set(c.start, c)
  }
  return (
    <p className="run-text">
      {block.segments.map((seg) => {
        if (seg.kind === 'text') return <span key={seg.start}>{seg.text}</span>
        const c = byStart.get(seg.start)
        if (!c || c.problem !== null || c.cue === null) {
          const problem = c?.problem ?? 'This cue cannot run.'
          return (
            <mark
              key={seg.start}
              className="cue bad"
              title={`Skipped: ${problem}`}
              data-testid="run-cue-bad"
            >
              {seg.raw}
              <span className="visually-hidden"> (will be skipped: {problem})</span>
            </mark>
          )
        }
        const isCurrent = current?.index === c.index
        const isNext = next?.index === c.index
        const classes = [
          'cue',
          'run-cue',
          CUE_CLASS[c.cue.type],
          isCurrent ? 'current' : '',
          isNext ? 'next' : '',
          c.index <= lastFired && !isCurrent ? 'done' : '',
        ]
        return (
          <button
            key={seg.start}
            type="button"
            className={classes.filter(Boolean).join(' ')}
            aria-label={`Jump to ${c.raw}: ${describeCue(c.cue, media)}`}
            aria-current={isCurrent ? 'step' : undefined}
            data-cue-index={c.index}
            data-testid="run-cue"
            onClick={() => runStore.getState().jumpToCue(c.index)}
          >
            {seg.raw}
          </button>
        )
      })}
    </p>
  )
}

function TimerPanel({ left, total }: { left: number; total: number }) {
  const done = left <= 0
  return (
    <section className="run-panel" aria-labelledby="run-timer-title">
      <h2 id="run-timer-title">Timer</h2>
      <p
        className={done ? 'run-timer done' : 'run-timer'}
        role="timer"
        aria-label="Timer"
        data-testid="run-timer"
      >
        {done ? 'Time is up' : formatClock(left)}
      </p>
      <p className="muted">Set for {formatClock(total)}.</p>
      <button type="button" className="btn" onClick={() => runStore.getState().stopTimer()}>
        Stop timer
      </button>
    </section>
  )
}

function NextUp({
  plan,
  pos,
  next,
  media,
  decks,
}: {
  plan: RunPlan
  pos: Position
  next: RunCue | null
  media: MediaSummary | null
  decks: SlideDeck[] | null
}) {
  const slideCue = nextSlideCue(plan, pos)
  const slideNumber = slideCue?.cue.type === 'slide' ? slideCue.cue.slide : null
  const where = slideNumber !== null ? slideAt(media?.decks ?? [], slideNumber) : null
  const nextBlock = next ? plan.blocks[next.blockIndex] : undefined

  return (
    <section className="run-panel" aria-labelledby="run-next-title">
      <h2 id="run-next-title">Next up</h2>
      {next?.cue ? (
        <p data-testid="next-cue">
          <code>{next.raw}</code> {describeCue(next.cue, media)}
          {nextBlock && next.blockIndex !== pos.block && (
            <span className="muted"> (in {blockName(nextBlock)})</span>
          )}
        </p>
      ) : (
        <p className="muted" data-testid="next-cue">
          No more cues.
        </p>
      )}
      {where && slideNumber !== null ? (
        <>
          <p className="muted run-next-slide">Next slide: {slideNumber}</p>
          <AudiencePreview
            screen={{
              mode: 'slide',
              deckId: where.deckId,
              index: where.index,
              number: slideNumber,
            }}
            decks={decks}
            label={`Next slide: slide ${slideNumber}`}
            testId="next-slide"
          />
        </>
      ) : (
        <p className="muted">No more slide cues.</p>
      )}
      <p className="hint muted">
        Space fires the next cue. Shift+Space goes back one cue without playing sounds again. Click
        a cue to jump to it.
      </p>
    </section>
  )
}
