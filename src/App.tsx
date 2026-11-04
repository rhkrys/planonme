import { useState } from 'react'
import { VIEWS, type ViewId } from './views'
import { Placeholder } from './views/Placeholder'

export default function App() {
  const [view, setView] = useState<ViewId>('plan')
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

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
        <Placeholder title={current.label} />
      </main>
    </div>
  )
}
