import { useEffect, useState } from 'react'
import { useSoundLibrarySync } from './audio/library'
import { useSoundKeys } from './audio/useSoundKeys'
import { AudienceBar, PopupBlockedHelp } from './components/AudienceBar'
import { WorkshopBar } from './components/WorkshopBar'
import { workshopStore } from './store/workshopStore'
import { VIEWS, type ViewId } from './views'
import { Placeholder } from './views/Placeholder'
import { PlanView } from './views/plan/PlanView'
import { ScriptView } from './views/script/ScriptView'
import { SlidesView } from './views/slides/SlidesView'
import { SoundsView } from './views/sounds/SoundsView'

export default function App() {
  const [view, setView] = useState<ViewId>('plan')
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  useEffect(() => {
    void workshopStore.getState().init()
  }, [])

  // Sounds load with the workshop, and their hotkeys work on every view.
  useSoundLibrarySync()
  useSoundKeys()

  // Ask before closing or reloading the tab while an edit is still being written.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (workshopStore.getState().pendingSaves > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

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
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <AudienceBar />
      </aside>
      <main className="content">
        <PopupBlockedHelp />
        <WorkshopBar />
        {current.id === 'plan' ? (
          <PlanView />
        ) : current.id === 'script' ? (
          <ScriptView />
        ) : current.id === 'slides' ? (
          <SlidesView />
        ) : current.id === 'sounds' ? (
          <SoundsView />
        ) : (
          <Placeholder title={current.label} />
        )}
      </main>
    </div>
  )
}
