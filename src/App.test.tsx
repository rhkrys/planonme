import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

test('shows the main views and switches between them', async () => {
  render(<App />)
  for (const name of ['Plan', 'Script', 'Slides', 'Sounds', 'Pre-flight', 'Run']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sounds' }))
  expect(screen.getByRole('heading', { name: 'Sounds' })).toBeInTheDocument()
})

test('Run mode links to the pre-flight checklist', async () => {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'Run' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Open pre-flight checklist' }))
  expect(screen.getByRole('heading', { name: 'Pre-flight', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pre-flight' })).toHaveAttribute('aria-current', 'page')
})
