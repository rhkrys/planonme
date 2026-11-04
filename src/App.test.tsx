import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

test('shows the five main views and switches between them', async () => {
  render(<App />)
  for (const name of ['Plan', 'Script', 'Slides', 'Sounds', 'Run']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sounds' }))
  expect(screen.getByRole('heading', { name: 'Sounds' })).toBeInTheDocument()
})
