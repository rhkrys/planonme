import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { audienceStore } from './store/audienceStore'
import { workshopStore } from './store/workshopStore'
import { startAudienceSync } from './sync/controller'
import { openBroadcastChannel } from './sync/protocol'

startAudienceSync({
  channel: openBroadcastChannel(),
  audience: audienceStore,
  workshop: workshopStore,
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
