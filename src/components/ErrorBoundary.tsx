import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What stopped working, for the message. */
  area?: string
}

interface State {
  error: Error | null
}

/**
 * Catches a crash in the part of the page below it, and shows what happened with a button to
 * try again, instead of a blank page. Saved work is in browser storage and is not touched.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('PlanOnMe hit an error it could not handle.', error, info.componentStack)
  }

  private recover = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const area = this.props.area ?? 'PlanOnMe'
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong</h2>
        <p>
          {area} stopped working because of an error. Your saved workshops are safe in this browser.
        </p>
        <p className="muted crash-detail">Details: {error.message || 'No details.'}</p>
        <div className="inline-form">
          <button type="button" className="btn primary" onClick={this.recover}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
