import { useEffect, useState } from 'react'
import { WorkshopBar } from './components/WorkshopBar'
import { workshopStore } from './store/workshopStore'
import { VIEWS, type ViewId } from './views'
import { Placeholder } from './views/Placeholder'
import { PlanView } from './views/plan/PlanView'
import { ScriptView } from './views/script/ScriptView'

export default function App() {
  const [view, setView] = useState<ViewId>('plan')
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  useEffect(() => {
    void workshopStore.getState().init()
  }, [])

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
      <nav className="sidebar" aria-label="Main">
        <div className="brand">PlanOnMe</div>
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
      <main className="content">
        <WorkshopBar />
        {current.id === 'plan' ? (
          <PlanView />
        ) : current.id === 'script' ? (
          <ScriptView />
        ) : (
          <Placeholder title={current.label} />
        )}
      </main>
    </div>
  )
}
