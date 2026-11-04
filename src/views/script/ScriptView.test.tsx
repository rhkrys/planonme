import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Block } from '../../db/types'
import { workshopStore } from '../../store/workshopStore'
import { MAX_SHOWN_PROBLEMS, ScriptView } from './ScriptView'

beforeAll(async () => {
  await workshopStore.getState().init()
})

let counter = 0
function block(id: string, title: string, script = ''): Block {
  return { id, title, kind: 'talk', durationMin: 10, goal: '', notes: '', script }
}

async function setup(blocks: Block[]) {
  counter += 1
  await workshopStore.getState().createWorkshop(`Script test ${counter}`)
  await workshopStore.getState().updateCurrent({ blocks })
  workshopStore.setState({
    media: {
      decks: [
        { id: 'd1', name: 'Intro deck', slideCount: 2 },
        { id: 'd2', name: 'Main deck', slideCount: 3 },
      ],
      sounds: [
        { id: 's1', name: 'Applause', kind: 'sfx' },
        { id: 's2', name: 'Break loop', kind: 'music' },
      ],
    },
  })
}

function stored() {
  const current = workshopStore.getState().current
  if (!current) throw new Error('no current workshop')
  return current
}

function editor(name: string) {
  return screen.getByRole('textbox', { name: `Script for ${name}` })
}

test('asks for blocks when the workshop has none', async () => {
  await setup([])
  render(<ScriptView />)
  expect(screen.getByText('No blocks yet.')).toBeInTheDocument()
})

test('edits a script per block and saves it', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome', 'Hello'), block('b', 'Exercise')])
  render(<ScriptView />)

  const list = screen.getByRole('navigation', { name: 'Script blocks' })
  expect(within(list).getByRole('button', { name: /^Welcome/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  expect(editor('Welcome')).toHaveValue('Hello')

  await user.click(within(list).getByRole('button', { name: /^Exercise/ }))
  const text = editor('Exercise')
  await user.type(text, 'Start now [[TIMER 5m] go')
  await waitFor(() => expect(stored().blocks[1]?.script).toBe('Start now [TIMER 5m] go'))
  expect(stored().blocks[0]?.script).toBe('Hello')
  await waitFor(() =>
    expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'),
  )
  expect(within(list).getByRole('button', { name: /^Exercise/ })).toHaveTextContent('1 cue')
})

test('switching blocks saves the text right away', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'One'), block('b', 'Two')])
  render(<ScriptView />)
  await user.type(editor('One'), 'Quick')
  await user.click(screen.getByRole('button', { name: /^Two/ }))
  expect(stored().blocks[0]?.script).toBe('Quick')
  expect(editor('Two')).toHaveValue('')
  await user.click(screen.getByRole('button', { name: /^One/ }))
  expect(editor('One')).toHaveValue('Quick')
})

test('highlights cues and lists problems', async () => {
  const user = userEvent.setup()
  await setup([
    block(
      'a',
      'Welcome',
      'Hi [SLIDE 2] [SFX applause]\n[SLIDE 9] [SFX boo]\n[TIMER 5x] [note] [MUSIC break loop]',
    ),
  ])
  render(<ScriptView />)
  const preview = screen.getByTestId('script-preview')
  expect(
    within(preview)
      .getAllByTestId('cue')
      .map((c) => c.textContent),
  ).toEqual(['[SLIDE 2]', '[SFX applause]', '[MUSIC break loop]'])
  expect(
    within(preview)
      .getAllByTestId('cue-bad')
      .map((c) => c.textContent),
  ).toEqual(['[SLIDE 9]', '[SFX boo]', '[TIMER 5x]'])
  expect(within(preview).getByText('[SLIDE 2]')).toHaveAttribute(
    'title',
    'Slide 2: Intro deck, slide 2',
  )
  expect(preview).toHaveTextContent('[note]')

  const problems = within(screen.getByRole('list', { name: 'Cue problems' })).getAllByRole('button')
  expect(problems.map((p) => p.getAttribute('aria-label'))).toEqual([
    'Line 2: [SLIDE 9]. There is no slide 9. This workshop has 5 slides. Show in script.',
    'Line 2: [SFX boo]. There is no sound named "boo". Show in script.',
    'Line 3: [TIMER 5x]. Use a time such as 5m, 30s or 1m30s. Show in script.',
  ])
  expect(screen.getByRole('button', { name: /^Welcome/ })).toHaveTextContent('3 problems')

  // Showing a problem selects its token in the editor.
  const text = editor('Welcome') as HTMLTextAreaElement
  await user.click(problems[1] as HTMLElement)
  expect(text).toHaveFocus()
  expect(text.value.slice(text.selectionStart, text.selectionEnd)).toBe('[SFX boo]')
})

test('says when there are no problems', async () => {
  await setup([block('a', 'Welcome', '[SLIDE 5] [STOP MUSIC]')])
  render(<ScriptView />)
  expect(screen.getByText('No problems found.')).toBeInTheDocument()
})

test('typing [ offers cues and the keyboard picks one', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome')])
  render(<ScriptView />)
  const text = editor('Welcome')

  await user.type(text, 'Go [[')
  const list = screen.getByRole('listbox', { name: 'Cue suggestions' })
  const options = within(list).getAllByRole('option')
  expect(options.map((o) => o.querySelector('.cue-option-label')?.textContent)).toEqual(
    expect.arrayContaining(['SLIDE', 'SFX', 'STOP MUSIC', 'SLIDE 5', 'SFX Applause']),
  )
  expect(options[0]).toHaveAttribute('aria-selected', 'true')
  expect(text).toHaveAttribute('aria-activedescendant', options[0]?.id)

  // Narrow down to sounds by name, move down and back up, then pick with Enter.
  await user.type(text, 'app')
  expect(within(list).getAllByRole('option')).toHaveLength(1)
  await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
  expect(text).toHaveValue('Go [SFX Applause]')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

  // A cue type keeps the list open for the next part.
  await user.type(text, ' [[sl')
  await user.keyboard('{Enter}')
  expect(text).toHaveValue('Go [SFX Applause] [SLIDE ')
  const slides = within(screen.getByRole('listbox')).getAllByRole('option')
  expect(slides[0]).toHaveTextContent('SLIDE 1')
  await user.keyboard('{ArrowDown}{Tab}')
  expect(text).toHaveValue('Go [SFX Applause] [SLIDE 2]')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  await waitFor(() => expect(stored().blocks[0]?.script).toBe('Go [SFX Applause] [SLIDE 2]'))
})

test('Escape closes the list and plain typing goes on', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome')])
  render(<ScriptView />)
  const text = editor('Welcome')
  await user.type(text, '[[')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  await user.type(text, 'aside]{Enter}more')
  expect(text).toHaveValue('[aside]\nmore')

  // Ctrl+Space opens the list again inside an open bracket.
  await user.type(text, ' [[x')
  await user.keyboard('{Escape}{Backspace}')
  await user.keyboard('{Control>} {/Control}')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
})

test('a mouse click on a suggestion inserts it', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome')])
  render(<ScriptView />)
  const text = editor('Welcome')
  await user.type(text, '[[stop')
  await user.click(screen.getByRole('option', { name: /STOP MUSIC/ }))
  expect(text).toHaveValue('[STOP MUSIC]')
  expect(text).toHaveFocus()
})

test('without media only malformed cues are checked', async () => {
  await setup([block('a', 'Welcome', '[SLIDE 40] [TIMER nope]')])
  workshopStore.setState({ media: null })
  render(<ScriptView />)
  expect(screen.getByText(/could not be read/)).toBeInTheDocument()
  expect(within(screen.getByTestId('script-preview')).getAllByTestId('cue-bad')).toHaveLength(1)
})

test('a script full of bad tokens lists only the first problems', async () => {
  const many = MAX_SHOWN_PROBLEMS + 30
  await setup([block('a', 'Welcome', '[SFX]\n'.repeat(many))])
  render(<ScriptView />)
  const problems = within(screen.getByRole('list', { name: 'Cue problems' })).getAllByRole('button')
  expect(problems).toHaveLength(MAX_SHOWN_PROBLEMS)
  expect(problems[MAX_SHOWN_PROBLEMS - 1]).toHaveAccessibleName(
    `Line ${MAX_SHOWN_PROBLEMS}: [SFX]. Add a sound name. Show in script.`,
  )
  expect(screen.getByTestId('more-problems')).toHaveTextContent('30 more not shown.')
  expect(screen.getByRole('button', { name: /^Welcome/ })).toHaveTextContent(`${many} problems`)
})

test('typing more moves the choice back to the first suggestion', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome')])
  render(<ScriptView />)
  const text = editor('Welcome')
  await user.type(text, '[[')
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(within(screen.getByRole('listbox')).getAllByRole('option')[2]).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.type(text, 'S')
  const options = within(screen.getByRole('listbox')).getAllByRole('option')
  expect(options[0]).toHaveAttribute('aria-selected', 'true')
  expect(options[0]).toHaveTextContent('SLIDE')
})

test('a hidden tab saves the text right away', async () => {
  const user = userEvent.setup()
  await setup([block('a', 'Welcome')])
  render(<ScriptView />)
  await user.type(editor('Welcome'), 'Before hide')
  const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  spy.mockRestore()
  expect(stored().blocks[0]?.script).toBe('Before hide')
})
