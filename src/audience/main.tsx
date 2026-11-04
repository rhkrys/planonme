import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { openBroadcastChannel } from '../sync/protocol'
import { AudienceApp } from './AudienceApp'
import { createSlideSource } from './slideSource'

const channel = openBroadcastChannel()
const loadSlide = createSlideSource()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AudienceApp channel={channel} loadSlide={loadSlide} />
    </StrictMode>,
  )
}
