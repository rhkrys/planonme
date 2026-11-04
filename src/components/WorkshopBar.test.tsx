import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { workshopStore } from '../store/workshopStore'
import { WorkshopBar } from './WorkshopBar'

beforeAll(async () => {
  await workshopStore.getState().init()
})

test('creates, renames and deletes a workshop with confirmation', async () => {
  const user = userEvent.setup()
  render(<WorkshopBar />)
  await screen.findByRole('combobox', { name: 'Current workshop' })

  await user.click(screen.getByRole('button', { name: 'New' }))
  await user.type(screen.getByRole('textbox', { name: 'Workshop name' }), 'Kickoff')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Current workshop' })).toHaveDisplayValue(
      'Kickoff',
    ),
  )

  await user.click(screen.getByRole('button', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'Workshop name' })
  await user.clear(input)
  await user.type(input, 'Kickoff day')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Current workshop' })).toHaveDisplayValue(
      'Kickoff day',
    ),
  )

  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('group', { name: 'Confirm delete' })).toHaveTextContent('Kickoff day')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('option', { name: 'Kickoff day' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: 'Kickoff day' })).not.toBeInTheDocument(),
  )
})

test('a bad import file shows an error message', async () => {
  const user = userEvent.setup({ applyAccept: false })
  render(<WorkshopBar />)
  await screen.findByRole('combobox', { name: 'Current workshop' })
  const file = new File(['{"format":"planonme","version":1'], 'broken.planonme')
  await user.upload(screen.getByLabelText('Import backup file'), file)
  expect(await screen.findByRole('alert')).toHaveTextContent(/damaged or cut off/)
  await user.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('delete confirmation focuses Cancel and Escape closes it', async () => {
  const user = userEvent.setup()
  render(<WorkshopBar />)
  await screen.findByRole('combobox', { name: 'Current workshop' })
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('group', { name: 'Confirm delete' })).toBeNull()
  expect(screen.getByRole('combobox', { name: 'Current workshop' })).toBeInTheDocument()
})
