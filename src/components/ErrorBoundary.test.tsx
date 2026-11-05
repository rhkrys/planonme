import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from './ErrorBoundary'

let broken = true
function Fragile() {
  if (broken) throw new Error('Bad data in the plan')
  return <p>All good</p>
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('shows a message and a recover button instead of a blank page', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  broken = true
  render(
    <ErrorBoundary area="The Plan view">
      <Fragile />
    </ErrorBoundary>,
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Something went wrong')
  expect(alert).toHaveTextContent('The Plan view stopped working')
  expect(alert).toHaveTextContent('Details: Bad data in the plan')
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()

  broken = false
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByText('All good')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
