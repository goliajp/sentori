import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomeView } from './home'

describe('HomeView', () => {
  it('renders the project name', () => {
    render(<HomeView />)
    expect(screen.getByRole('heading', { name: /sentori/i })).toBeInTheDocument()
  })
})
