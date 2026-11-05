import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { NoWorkshop } from '../../components/EmptyState'
import { audioEngine } from '../../audio/engine'
import { useSoundLibrary } from '../../audio/library'
import {
  audienceCheck,
  cuesCheck,
  findCueIssues,
  HEARD_TONE,
  masterWarning,
  progress,
  slidesCheck,
  soundsCheck,
  ZOOM_ITEMS,
  type CheckResult,
  type CheckStatus,
  type LiveCheckId,
  type ManualItem,
  type SoundResult,
} from '../../preflight/checklist'
import { tickStore, useTicks } from '../../preflight/ticks'
import { audienceStore, useAudienceStore } from '../../store/audienceStore'
import { useWorkshopStore } from '../../store/workshopStore'
import { openAudienceWindow } from '../../sync/popup'
import { PREFLIGHT_TITLE_ID } from '../../views'

/** Most cue problems listed at once. The rest are counted. */
const MAX_LISTED_ISSUES = 20

const BADGES: Record<CheckStatus, string> = {
  ok: 'OK',
  warn: 'Check',
  fail: 'Problem',
  checking: 'Checking',
}

/**
 * Decodes every sound of the current workshop, one at a time, to check that it plays. Runs
 * again when the sounds change or when recheck is called.
 */
function useSoundChecks() {
  const currentId = useWorkshopStore((s) => s.currentId)
  const libraryId = useSoundLibrary((s) => s.workshopId)
  const loaded = useSoundLibrary((s) => s.sounds)
  const failed = useSoundLibrary((s) => s.failed)
  const sounds = libraryId === currentId ? loaded : null
  const [results, setResults] = useState<Record<string, SoundResult>>({})
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!sounds) return
    let stale = false
    setResults({})
    void (async () => {
      for (const sound of sounds) {
        if (stale) return
        let message: string | null
        try {
          message = await audioEngine.checkSound(sound)
        } catch {
          message = 'This sound could not be checked.'
        }
        if (stale) return
        const result: SoundResult = message === null ? { ok: true } : { ok: false, message }
        setResults((r) => ({ ...r, [sound.id]: result }))
      }
    })()
    return () => {
      stale = true
    }
  }, [sounds, round])

  return {
    sounds: libraryId === currentId && !failed ? sounds : null,
    results,
    failed: libraryId === currentId && failed,
    recheck: () => setRound((n) => n + 1),
  }
}

/** The Zoom pre-flight checklist. */
export function PreflightView() {
  const status = useWorkshopStore((s) => s.status)
  const currentId = useWorkshopStore((s) => s.currentId)

  if (status !== 'ready' || !currentId) {
    return (
      <section className="preflight">
        <h1 id={PREFLIGHT_TITLE_ID} tabIndex={-1}>
          Pre-flight
        </h1>
        <NoWorkshop status={status} />
      </section>
    )
  }
  return <Checklist workshopId={currentId} />
}

function Checklist({ workshopId }: { workshopId: string }) {
  const blocks = useWorkshopStore((s) => s.current?.blocks)
  const media = useWorkshopStore((s) => s.media)
  const connected = useAudienceStore((s) => s.connected)
  const engine = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot)
  const ticks = useTicks(workshopId)
  const soundChecks = useSoundChecks()

  const cueScan = useMemo(() => findCueIssues(blocks ?? [], media), [blocks, media])
  const live: Record<LiveCheckId, CheckResult> = {
    audience: audienceCheck(connected),
    slides: slidesCheck(media),
    cues: cuesCheck(cueScan.cues, cueScan.issues, media),
    sounds: soundsCheck(soundChecks.sounds, soundChecks.results, soundChecks.failed),
  }
  const { done, total, ready } = progress(live, ticks)
  const badSounds = (soundChecks.sounds ?? []).flatMap((s) => {
    const r = soundChecks.results[s.id]
    return r && !r.ok ? [{ id: s.id, name: s.name, message: r.message }] : []
  })
  const volumeWarning = masterWarning(engine.master)
  const shownIssues = cueScan.issues.slice(0, MAX_LISTED_ISSUES)
  const moreIssues = cueScan.issues.length - shownIssues.length

  function setTick(id: string, on: boolean) {
    tickStore.getState().setTick(workshopId, id, on)
  }

  function openAudience() {
    const result = openAudienceWindow()
    audienceStore.getState().setPopupBlocked(result === 'blocked')
  }

  return (
    <section className="preflight">
      <h1 id={PREFLIGHT_TITLE_ID} tabIndex={-1}>
        Pre-flight
      </h1>
      <p className="muted">Check these before you share your screen in Zoom.</p>

      <div className="preflight-summary">
        <p
          className={ready ? 'preflight-progress ready' : 'preflight-progress'}
          data-testid="preflight-progress"
          aria-live="polite"
        >
          {ready ? 'All set. You are ready to go live.' : `${done} of ${total} done.`}
        </p>
        {/* aria-disabled rather than disabled, so keyboard focus stays on the button. */}
        <button
          type="button"
          className="btn"
          aria-disabled={ticks.length === 0}
          onClick={() => tickStore.getState().clear(workshopId)}
        >
          Clear ticks
        </button>
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

      <h2>In PlanOnMe</h2>
      <ul className="checks">
        <CheckRow id="audience" title="Audience window" result={live.audience}>
          {/* Always shown, so focus is not lost when the window connects. */}
          <button type="button" className="btn" onClick={openAudience}>
            {connected ? 'Show the audience window' : 'Open the audience window'}
          </button>
        </CheckRow>

        <CheckRow id="slides" title="Slides" result={live.slides} />

        <CheckRow id="cues" title="Script cues" result={live.cues}>
          {shownIssues.length > 0 && (
            <ul className="check-details" aria-label="Cue problems">
              {shownIssues.map((issue, i) => (
                <li key={`${issue.blockId}-${i}`}>
                  {issue.blockTitle}, line {issue.line}: <code>{issue.raw}</code>. {issue.message}
                </li>
              ))}
              {moreIssues > 0 && <li className="muted">And {moreIssues} more.</li>}
            </ul>
          )}
        </CheckRow>

        <CheckRow id="sounds" title="Sounds" result={live.sounds}>
          {badSounds.length > 0 && (
            <ul className="check-details" aria-label="Sound problems">
              {badSounds.map((s) => (
                <li key={s.id}>
                  {s.name}: {s.message}
                </li>
              ))}
            </ul>
          )}
          {soundChecks.sounds && soundChecks.sounds.length > 0 && (
            <button
              type="button"
              className="btn"
              aria-disabled={live.sounds.status === 'checking'}
              onClick={() => {
                if (live.sounds.status !== 'checking') soundChecks.recheck()
              }}
            >
              Check sounds again
            </button>
          )}
        </CheckRow>

        <li
          className="preflight-check"
          data-testid="check-tone"
          data-status={ticks.includes(HEARD_TONE.id) ? 'ok' : 'todo'}
        >
          <span className={`check-badge ${ticks.includes(HEARD_TONE.id) ? 'ok' : 'todo'}`}>
            {ticks.includes(HEARD_TONE.id) ? 'OK' : 'To do'}
          </span>
          <div className="check-body">
            <h3 className="check-title">Test tone</h3>
            <p className="check-message">
              Plays a short beep through the master volume (now {Math.round(engine.master * 100)}%).
              Ask someone in the call if they hear it.
            </p>
            {volumeWarning && <p className="message warn">{volumeWarning}</p>}
            <div className="inline-form">
              <button
                type="button"
                className="btn primary"
                onClick={() => void audioEngine.playTestTone()}
              >
                Play test tone
              </button>
              <span className="muted" aria-live="polite" data-testid="tone-state">
                {engine.testTone ? 'Playing...' : ''}
              </span>
            </div>
            <Tick item={HEARD_TONE} ticked={ticks.includes(HEARD_TONE.id)} onChange={setTick} />
          </div>
        </li>
      </ul>

      <h2>In Zoom</h2>
      <ol className="ticks">
        {ZOOM_ITEMS.map((item) => (
          <li key={item.id}>
            <Tick item={item} ticked={ticks.includes(item.id)} onChange={setTick} />
          </li>
        ))}
      </ol>
      <p className="muted">Ticks are kept for this workshop until you close the browser tab.</p>

      <h2>Audience window size</h2>
      <p>
        Drag a corner of the audience window to make it bigger or smaller. Slides scale to fit any
        size. It never goes full screen, so this control window and your notes stay on your desktop
        next to it. Zoom shares the window at the size it has.
      </p>
    </section>
  )
}

function CheckRow({
  id,
  title,
  result,
  children,
}: {
  id: string
  title: string
  result: CheckResult
  children?: ReactNode
}) {
  return (
    <li className="preflight-check" data-testid={`check-${id}`} data-status={result.status}>
      <span className={`check-badge ${result.status}`}>{BADGES[result.status]}</span>
      <div className="check-body">
        <h3 className="check-title">{title}</h3>
        <p className="check-message">{result.message}</p>
        {children}
      </div>
    </li>
  )
}

function Tick({
  item,
  ticked,
  onChange,
}: {
  item: ManualItem
  ticked: boolean
  onChange: (id: string, on: boolean) => void
}) {
  const helpId = useId()
  return (
    <div className="tick">
      <label className="tick-label">
        <input
          type="checkbox"
          checked={ticked}
          aria-describedby={helpId}
          onChange={(e) => onChange(item.id, e.target.checked)}
        />
        {item.label}
      </label>
      <p id={helpId} className="tick-help muted">
        {item.help}
      </p>
    </div>
  )
}
