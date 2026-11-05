import { useEffect, useState } from 'react'
import { useSoundLibrarySync } from './audio/library'
import { useSoundKeys } from './audio/useSoundKeys'
import { AudienceBar, PopupBlockedHelp } from './components/AudienceBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShortcutHelp } from './components/ShortcutHelp'
import { useAppKeys } from './components/useAppKeys'
import { WorkshopBar } from './components/WorkshopBar'
import { workshopStore } from './store/workshopStore'
import { PREFLIGHT_TITLE_ID, VIEWS, type ViewId } from './views'
import { PlanView } from './views/plan/PlanView'
import { PreflightView } from './views/preflight/PreflightView'
import { RunView } from './views/run/RunView'
import { ScriptView } from './views/script/ScriptView'
import { SlidesView } from './views/slides/SlidesView'
import { SoundsView } from './views/sounds/SoundsView'

export default function App() {
  const [view, setView] = useState<ViewId>('plan')
  const [helpOpen, setHelpOpen] = useState(false)
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  useAppKeys({ onView: setView, onHelp: () => setHelpOpen((open) => !open), paused: helpOpen })

  useEffect(() => {
    void workshopStore.getState().init()
  }, [])

  // Sounds load with the workshop, and their hotkeys work on every view.
  useSoundLibrarySync()
  useSoundKeys()

  // Another tab may have changed this workshop. Read it again when this tab comes back.
  useEffect(() => {
    function onBack() {
      if (document.visibilityState === 'visible') void workshopStore.getState().reloadCurrent()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [])

  // Ask before closing or reloading the tab while an edit is still being written.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (workshopStore.getState().pendingSaves > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // The link in Run mode goes away with Run mode, so move focus to the checklist heading.
  function openPreflight() {
    setView('preflight')
    requestAnimationFrame(() => document.getElementById(PREFLIGHT_TITLE_ID)?.focus())
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">PlanOnMe</div>
        <nav className="sidebar-nav" aria-label="Main">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={v.id === view ? 'nav-item active' : 'nav-item'}
              aria-current={v.id === view ? 'page' : undefined}
              aria-keyshortcuts={v.hotkey}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <AudienceBar />
        <button
          type="button"
          className="btn help-button"
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          onClick={() => setHelpOpen(true)}
        >
          Keyboard shortcuts <kbd aria-hidden="true">?</kbd>
        </button>
      </aside>
      <main className="content">
        <PopupBlockedHelp />
        <WorkshopBar />
        {/* A new key per view, so opening another view also recovers from a crash. */}
        <ErrorBoundary key={current.id} area={`The ${current.label} view`}>
          {current.id === 'plan' ? (
            <PlanView />
          ) : current.id === 'script' ? (
            <ScriptView />
          ) : current.id === 'slides' ? (
            <SlidesView />
          ) : current.id === 'sounds' ? (
            <SoundsView />
          ) : current.id === 'preflight' ? (
            <PreflightView />
          ) : (
            <RunView onOpenPreflight={openPreflight} />
          )}
        </ErrorBoundary>
      </main>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
