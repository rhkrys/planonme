import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { openBroadcastChannel } from '../sync/protocol'
import { AudienceApp } from './AudienceApp'
import { createSlideSource } from './slideSource'

const channel = openBroadcastChannel()
const loadSlide = createSlideSource()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary area="The audience window">
        <AudienceApp channel={channel} loadSlide={loadSlide} />
      </ErrorBoundary>
    </StrictMode>,
  )
}
