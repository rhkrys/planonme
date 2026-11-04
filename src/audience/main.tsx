import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'

function Audience() {
  return <div className="audience" data-testid="audience" />
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Audience />
    </StrictMode>,
  )
}
