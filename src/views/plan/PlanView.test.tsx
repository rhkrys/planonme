import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { workshopStore } from '../../store/workshopStore'
import { PlanView } from './PlanView'

beforeAll(async () => {
  await workshopStore.getState().init()
})

let counter = 0
beforeEach(async () => {
  counter += 1
  await workshopStore.getState().createWorkshop(`Test ${counter}`)
})

function stored() {
  const current = workshopStore.getState().current
  if (!current) throw new Error('no current workshop')
  return current
}

function rowTitles() {
  return screen
    .getAllByTestId('block-row')
    .map((row) => row.querySelector('.block-title')?.textContent)
}

async function addBlock(user: ReturnType<typeof userEvent.setup>, title: string, minutes: string) {
  await user.type(screen.getByRole('textbox', { name: 'New block title' }), title)
  const mins = screen.getByRole('textbox', { name: 'New block minutes' })
  await user.clear(mins)
  await user.type(mins, minutes)
  await user.click(screen.getByRole('button', { name: 'Add block' }))
  await screen.findByText(title, { selector: '.block-title' })
}

async function setSessionLength(user: ReturnType<typeof userEvent.setup>, minutes: string) {
  const input = screen.getByRole('textbox', { name: 'Session length (minutes)' })
  await user.clear(input)
  await user.type(input, `${minutes}{Enter}`)
}

test('shows an empty state when there is no workshop', () => {
  const saved = workshopStore.getState()
  workshopStore.setState({ status: 'ready', current: null, currentId: null })
  try {
    render(<PlanView />)
    expect(screen.getByText('No workshop yet.')).toBeInTheDocument()
  } finally {
    workshopStore.setState({
      status: saved.status,
      current: saved.current,
      currentId: saved.currentId,
    })
  }
})

test('adds blocks and shows start times, total and time left', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  expect(screen.getByText('No blocks yet.')).toBeInTheDocument()

  await setSessionLength(user, '60')
  await waitFor(() => expect(stored().durationMin).toBe(60))
  expect(screen.getByText('Planned 0 min of 1 h')).toBeInTheDocument()

  await addBlock(user, 'Welcome', '10')
  await addBlock(user, 'Warm up', '20')
  await addBlock(user, 'Coffee', '15')

  expect(rowTitles()).toEqual(['Welcome', 'Warm up', 'Coffee'])
  const starts = screen.getAllByTestId('block-row').map((r) => r.querySelector('.block-start'))
  expect(starts.map((s) => s?.textContent)).toEqual([
    'Starts at 0:00',
    'Starts at 0:10',
    'Starts at 0:30',
  ])
  expect(screen.getByText('Planned 45 min of 1 h')).toBeInTheDocument()
  expect(screen.getByText('15 min left')).toBeInTheDocument()
  expect(stored().blocks.map((b) => [b.title, b.durationMin])).toEqual([
    ['Welcome', 10],
    ['Warm up', 20],
    ['Coffee', 15],
  ])
})

test('warns when the plan runs over the session length', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await setSessionLength(user, '30')
  await addBlock(user, 'Talk', '25')
  await addBlock(user, 'Exercise', '20')
  expect(screen.getByText(/Over time by 15 min/)).toBeInTheDocument()
  const rows = screen.getAllByTestId('block-row')
  expect(within(rows[0] as HTMLElement).queryByText('Past session end')).not.toBeInTheDocument()
  expect(within(rows[1] as HTMLElement).getByText('Past session end')).toBeInTheDocument()

  await setSessionLength(user, '45')
  await waitFor(() => expect(screen.queryByText(/Over time/)).not.toBeInTheDocument())
  expect(screen.getByText('0 min left')).toBeInTheDocument()
})

test('rejects bad durations with a readable message', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  const title = screen.getByRole('textbox', { name: 'New block title' })
  const minutes = screen.getByRole('textbox', { name: 'New block minutes' })

  await user.type(title, 'Long talk')
  for (const bad of ['1.5', '-3', 'ten', '601']) {
    await user.clear(minutes)
    await user.type(minutes, bad)
    await user.click(screen.getByRole('button', { name: 'Add block' }))
    expect(screen.getByText(/whole minutes|600 minutes or less/)).toBeInTheDocument()
    expect(minutes).toHaveAttribute('aria-invalid', 'true')
  }
  expect(screen.queryAllByTestId('block-row')).toHaveLength(0)

  await user.clear(minutes)
  await user.type(minutes, '600')
  await user.click(screen.getByRole('button', { name: 'Add block' }))
  await screen.findByText('Long talk', { selector: '.block-title' })
  expect(screen.queryByText(/whole minutes/)).not.toBeInTheDocument()

  const before = stored().durationMin
  await setSessionLength(user, '2.5')
  expect(screen.getByText(/whole minutes/)).toBeInTheDocument()
  expect(stored().durationMin).toBe(before)
})

test('needs a title to add a block', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await user.click(screen.getByRole('button', { name: 'Add block' }))
  expect(screen.getByText('Enter a block title.')).toBeInTheDocument()
  expect(stored().blocks).toHaveLength(0)
})

test('moves blocks with the up and down buttons and keeps focus', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await addBlock(user, 'A', '5')
  await addBlock(user, 'B', '10')
  await addBlock(user, 'C', '15')

  expect(screen.getByRole('button', { name: 'Move A up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move C down' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Move A down' }))
  await waitFor(() => expect(rowTitles()).toEqual(['B', 'A', 'C']))
  expect(screen.getByRole('button', { name: 'Move A down' })).toHaveFocus()

  await user.click(screen.getByRole('button', { name: 'Move C up' }))
  await waitFor(() => expect(rowTitles()).toEqual(['B', 'C', 'A']))
  await user.click(screen.getByRole('button', { name: 'Move C up' }))
  await waitFor(() => expect(rowTitles()).toEqual(['C', 'B', 'A']))
  // C is now first, so its up button is disabled and focus moves to its down button.
  expect(screen.getByRole('button', { name: 'Move C down' })).toHaveFocus()

  await waitFor(() => expect(stored().blocks.map((b) => b.title)).toEqual(['C', 'B', 'A']))
  const starts = screen.getAllByTestId('block-row').map((r) => r.querySelector('.block-start'))
  expect(starts.map((s) => s?.textContent)).toEqual([
    'Starts at 0:00',
    'Starts at 0:15',
    'Starts at 0:25',
  ])
})

test('reorders blocks by drag and drop', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await addBlock(user, 'One', '5')
  await addBlock(user, 'Two', '5')
  await addBlock(user, 'Three', '5')

  const data = new Map<string, string>()
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
  function fire(el: HTMLElement, type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd') {
    const event = createEvent[type](el)
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    fireEvent(el, event)
  }

  const [one, , three] = screen.getAllByTestId('block-row') as HTMLElement[]
  if (!one || !three) throw new Error('missing rows')
  fire(one, 'dragStart')
  fire(three, 'dragOver')
  expect(three).toHaveClass('drop-target')
  fire(three, 'drop')
  fire(one, 'dragEnd')

  await waitFor(() => expect(rowTitles()).toEqual(['Two', 'Three', 'One']))
  await waitFor(() => expect(stored().blocks.map((b) => b.title)).toEqual(['Two', 'Three', 'One']))
})

test('edits a block', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await addBlock(user, 'Intro', '10')

  await user.click(screen.getByRole('button', { name: 'Edit Intro' }))
  const form = screen.getByRole('form', { name: 'Edit block Intro' })
  const title = within(form).getByRole('textbox', { name: 'Block title' })
  await user.clear(title)
  await user.type(title, 'Opening')
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Block kind' }), 'discussion')
  const minutes = within(form).getByRole('textbox', { name: 'Block minutes' })
  await user.clear(minutes)
  await user.type(minutes, 'abc')
  await user.click(within(form).getByRole('button', { name: 'Save block' }))
  expect(within(form).getByText(/whole minutes/)).toBeInTheDocument()

  await user.clear(minutes)
  await user.type(minutes, '25')
  await user.type(within(form).getByRole('textbox', { name: 'Block goal' }), 'Everyone talks')
  await user.type(within(form).getByRole('textbox', { name: 'Block notes' }), 'Use the mic')
  await user.click(within(form).getByRole('button', { name: 'Save block' }))

  await screen.findByText('Opening', { selector: '.block-title' })
  expect(screen.getByText('Goal: Everyone talks')).toBeInTheDocument()
  expect(screen.getByText('Use the mic')).toBeInTheDocument()
  expect(screen.getByText('Discussion', { selector: '.kind-badge' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit Opening' })).toHaveFocus()
  await waitFor(() =>
    expect(stored().blocks[0]).toMatchObject({
      title: 'Opening',
      kind: 'discussion',
      durationMin: 25,
      goal: 'Everyone talks',
      notes: 'Use the mic',
    }),
  )

  await user.click(screen.getByRole('button', { name: 'Edit Opening' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('form', { name: /Edit block/ })).not.toBeInTheDocument()
})

test('deletes a block after confirmation', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  await addBlock(user, 'Keep', '5')
  await addBlock(user, 'Drop', '5')

  await user.click(screen.getByRole('button', { name: 'Delete Drop' }))
  const confirm = screen.getByRole('group', { name: 'Confirm delete block Drop' })
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(rowTitles()).toEqual(['Keep', 'Drop'])

  await user.click(screen.getByRole('button', { name: 'Delete Drop' }))
  await user.click(screen.getByRole('button', { name: 'Delete block' }))
  await waitFor(() => expect(rowTitles()).toEqual(['Keep']))
  await waitFor(() => expect(stored().blocks.map((b) => b.title)).toEqual(['Keep']))
})

test('edits the workshop settings', async () => {
  const user = userEvent.setup()
  render(<PlanView />)
  const title = screen.getByRole('textbox', { name: 'Workshop title' })
  await user.clear(title)
  await user.type(title, 'Team day{Enter}')
  await waitFor(() => expect(stored().title).toBe('Team day'))

  await user.clear(title)
  await user.tab()
  expect(screen.getByText('Enter a workshop title.')).toBeInTheDocument()
  expect(stored().title).toBe('Team day')

  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-01' } })
  await waitFor(() => expect(stored().date).toBe('2026-12-01'))
})
