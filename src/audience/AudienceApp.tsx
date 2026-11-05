import { useEffect, useRef, useState } from 'react'
import {
  sameScreen,
  type AudienceScreen,
  type SlideProblem,
  type SyncChannel,
} from '../sync/protocol'
import { SlideMissingError, type LoadSlide } from './slideSource'

/** Hide the mouse pointer after it has not moved for this long. */
export const CURSOR_IDLE_MS = 2000

type View =
  | { kind: 'waiting' }
  | { kind: 'blank' }
  | { kind: 'logo'; title: string }
  | { kind: 'slide'; url: string; number: number }
  | { kind: 'problem' }

/** Waits until the image can be painted, so a new slide replaces the old one without a flash. */
async function decodeImage(url: string): Promise<void> {
  if (typeof Image !== 'function') return
  const img = new Image()
  img.src = url
  if (typeof img.decode === 'function') await img.decode()
}

/**
 * The audience window: only the current slide on black, with no controls. The control window
 * says what to show over the channel; slide images are read from the shared IndexedDB.
 */
export function AudienceApp({
  channel,
  loadSlide,
}: {
  channel: SyncChannel | null
  loadSlide: LoadSlide
}) {
  const [view, setView] = useState<View>({ kind: 'waiting' })
  const [idle, setIdle] = useState(false)
  const target = useRef<AudienceScreen | null>(null)
  const problem = useRef<SlideProblem | null>(null)
  const seq = useRef(0)
  const url = useRef<string | null>(null)

  useEffect(() => {
    if (!channel) return
    const link = channel
    let stopped = false
    const stale = (mine: number) => stopped || mine !== seq.current

    function report() {
      link.post({
        v: 1,
        from: 'audience',
        type: 'status',
        screen: target.current,
        problem: problem.current,
      })
    }

    function swapUrl(next: string | null) {
      if (url.current && url.current !== next) URL.revokeObjectURL(url.current)
      url.current = next
    }

    async function show(screen: AudienceScreen) {
      if (sameScreen(screen, target.current) && problem.current === null) {
        report()
        return
      }
      target.current = screen
      problem.current = null
      const mine = ++seq.current
      if (screen.mode !== 'slide') {
        swapUrl(null)
        setView(screen.mode === 'blank' ? { kind: 'blank' } : { kind: 'logo', title: screen.title })
        report()
        return
      }
      let made: string | null = null
      try {
        const blob = await loadSlide(screen.deckId, screen.index)
        if (stale(mine)) return
        made = URL.createObjectURL(blob)
        await decodeImage(made)
        if (stale(mine)) {
          URL.revokeObjectURL(made)
          return
        }
        swapUrl(made)
        setView({ kind: 'slide', url: made, number: screen.number })
      } catch (err) {
        if (made) URL.revokeObjectURL(made)
        if (stale(mine)) return
        console.error(err)
        problem.current = err instanceof SlideMissingError ? 'missing' : 'error'
        swapUrl(null)
        setView({ kind: 'problem' })
      }
      report()
    }

    const unlisten = link.listen((message) => {
      if (message.from !== 'control') return
      if (message.type === 'hello') report()
      else void show(message.screen)
    })
    link.post({ v: 1, from: 'audience', type: 'hello' })
    const bye = () => link.post({ v: 1, from: 'audience', type: 'bye' })
    window.addEventListener('pagehide', bye)
    return () => {
      stopped = true
      // A load cut short here never finished, so the same screen must load again next time.
      target.current = null
      unlisten()
      window.removeEventListener('pagehide', bye)
    }
  }, [channel, loadSlide])

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = null
    },
    [],
  )

  // Hide the pointer when it rests, so it does not sit on top of the slide in the share.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    function wake() {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
    }
  }, [])

  return (
    <main
      className={idle ? 'audience idle' : 'audience'}
      data-testid="audience"
      data-mode={view.kind}
    >
      {!channel ? (
        <div className="audience-note">
          <p>This browser cannot link the two windows.</p>
          <p className="audience-small">Use a recent version of Chrome, Edge or Firefox.</p>
        </div>
      ) : view.kind === 'waiting' ? (
        <div className="audience-note audience-waiting" role="status">
          <p>Waiting for PlanOnMe</p>
          <p className="audience-small">Keep the PlanOnMe tab open in this browser.</p>
        </div>
      ) : view.kind === 'slide' ? (
        <img
          className="audience-slide"
          data-testid="audience-slide"
          src={view.url}
          alt={`Slide ${view.number}`}
          draggable={false}
        />
      ) : view.kind === 'logo' ? (
        <div className="audience-logo" data-testid="audience-logo">
          <p>{view.title}</p>
        </div>
      ) : view.kind === 'problem' ? (
        <div className="audience-note" data-testid="audience-problem">
          <p className="audience-small">This slide could not be shown.</p>
        </div>
      ) : (
        <div className="audience-blank" data-testid="audience-blank" />
      )}
    </main>
  )
}
