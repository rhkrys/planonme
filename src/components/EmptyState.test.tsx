import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { workshopStore } from '../store/workshopStore'
import { NoWorkshop } from './EmptyState'

afterEach(() => {
  vi.restoreAllMocks()
})

test('with no workshop at all, offers the sample', async () => {
  const createSampleWorkshop = vi.fn().mockResolvedValue(true)
  workshopStore.setState({ status: 'ready', createSampleWorkshop })
  render(<NoWorkshop status="ready" />)
  expect(screen.getByText('No workshop yet.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Load sample workshop' }))
  expect(createSampleWorkshop).toHaveBeenCalledTimes(1)
  expect(createSampleWorkshop.mock.calls[0]?.[0]).toBeTypeOf('function')
})

test('says when loading or when saved workshops did not open', () => {
  const { rerender } = render(<NoWorkshop status="loading" />)
  expect(screen.getByText('Loading...')).toBeInTheDocument()
  rerender(<NoWorkshop status="error" />)
  expect(screen.getByText(/Saved workshops could not be opened/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
