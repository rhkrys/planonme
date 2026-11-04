import { useEffect, useState, type ReactNode } from 'react'
import type { SlideDeck } from '../db/types'
import { totalSlides } from '../slides/decks'
import { screenFor, useAudienceStore, audienceStore } from '../store/audienceStore'
import { useWorkshopStore } from '../store/workshopStore'
import type { AudienceScreen } from '../sync/protocol'
import { useAudienceKeys } from './useAudienceKeys'

/**
 * The audience screen controls: a small live preview of what the audience sees, previous and
 * next, and the blank and logo screens. The keyboard works while this panel is shown.
 */
export function AudiencePanel({ decks }: { decks: SlideDeck[] | null }) {
  useAudienceKeys()
  const slide = useAudienceStore((s) => s.slide)
  const overlay = useAudienceStore((s) => s.overlay)
  const connected = useAudienceStore((s) => s.connected)
  const problem = useAudienceStore((s) => s.problem)
  const media = useWorkshopStore((s) => s.media)
  const title = useWorkshopStore((s) => s.current?.title ?? '')

  const counts = media?.decks ?? []
  const total = totalSlides(counts)
  const screen = screenFor({ slide, overlay }, counts, title)
  const shownNumber = screenFor({ slide, overlay: 'none' }, counts, title)
  const number = shownNumber.mode === 'slide' ? shownNumber.number : null
  const store = audienceStore.getState()

  let label: string
  if (overlay === 'blank') label = 'Blank screen is on.'
  else if (overlay === 'logo') label = 'Logo screen is on.'
  else if (number !== null) label = `Showing slide ${number} of ${total}.`
  else label = 'The audience sees the logo screen until you import slides.'

  return (
    <section className="audience-panel" aria-labelledby="audience-panel-title">
      <h2 id="audience-panel-title">Audience screen</h2>
      <div className="audience-panel-body">
        <AudiencePreview screen={screen} decks={decks} />
        <div className="audience-panel-side">
          <p data-testid="audience-now">{label}</p>
          <div className="inline-form">
            <button
              type="button"
              className="btn"
              aria-label="Previous slide"
              aria-keyshortcuts="ArrowLeft"
              disabled={total === 0 || (overlay === 'none' && number === 1)}
              onClick={() => store.step(-1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Next slide"
              aria-keyshortcuts="ArrowRight"
              disabled={total === 0 || (overlay === 'none' && number === total)}
              onClick={() => store.step(1)}
            >
              Next →
            </button>
            <button
              type="button"
              className={overlay === 'blank' ? 'btn primary' : 'btn'}
              aria-pressed={overlay === 'blank'}
              aria-keyshortcuts="B"
              onClick={() => store.toggleBlank()}
            >
              Blank (B)
            </button>
            <button
              type="button"
              className={overlay === 'logo' ? 'btn primary' : 'btn'}
              aria-pressed={overlay === 'logo'}
              aria-keyshortcuts="L"
              onClick={() => store.toggleLogo()}
            >
              Logo (L)
            </button>
          </div>
          <p className="hint muted">
            Keys: left and right arrows change the slide, B blanks the screen, L shows the logo
            screen. Click a slide below to show it.
          </p>
          {!connected && (
            <p className="hint muted">
              The audience window is not open. Click Open audience window, then share that window in
              Zoom.
            </p>
          )}
          {connected && problem && (
            <p className="message warn">
              {problem === 'missing'
                ? 'The audience window cannot find this slide.'
                : 'The audience window cannot show this slide.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** A small copy of the audience screen. */
export function AudiencePreview({
  screen,
  decks,
}: {
  screen: AudienceScreen
  decks: SlideDeck[] | null
}) {
  const blob =
    screen.mode === 'slide'
      ? decks?.find((d) => d.id === screen.deckId)?.slides[screen.index]
      : undefined
  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(null)
      return
    }
    const made = URL.createObjectURL(blob)
    setUrl({ blob, url: made })
    return () => URL.revokeObjectURL(made)
  }, [blob])

  let inner: ReactNode
  if (screen.mode === 'blank') {
    inner = <span className="preview-note">Blank</span>
  } else if (screen.mode === 'logo') {
    inner = <span className="preview-logo">{screen.title}</span>
  } else if (url && url.blob === blob && !broken) {
    inner = <img src={url.url} alt="" onError={() => setBroken(true)} />
  } else {
    inner = <span className="preview-note">{broken ? 'Cannot show' : ''}</span>
  }

  const name =
    screen.mode === 'slide'
      ? `Audience preview: slide ${screen.number}`
      : screen.mode === 'blank'
        ? 'Audience preview: blank screen'
        : 'Audience preview: logo screen'

  return (
    <div className="audience-preview" role="img" aria-label={name} data-testid="audience-preview">
      {inner}
    </div>
  )
}
