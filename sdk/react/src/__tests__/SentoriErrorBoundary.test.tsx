import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'bun:test'

import { SentoriErrorBoundary } from '../SentoriErrorBoundary.js'
import { SentoriProvider } from '../SentoriProvider.js'

const PROVIDER_PROPS = {
  config: {
    environment: 'test',
    ingestUrl: 'http://localhost:0',
    release: 'test@0.0.0',
    token: 'st_pk_testtesttesttesttesttesttest',
  },
}

const Boom = (): never => {
  throw new Error('boom-from-render')
}

describe('SentoriErrorBoundary', () => {
  test('renders children when nothing throws', () => {
    render(
      <SentoriProvider {...PROVIDER_PROPS}>
        <SentoriErrorBoundary fallback={() => <div>fallback</div>}>
          <div>ok</div>
        </SentoriErrorBoundary>
      </SentoriProvider>,
    )
    expect(screen.getByText('ok')).toBeDefined()
  })

  test('renders fallback when child throws', () => {
    // Suppress React's noisy "uncaught error" log in the test output.
    const original = console.error
    console.error = () => {}
    try {
      render(
        <SentoriProvider {...PROVIDER_PROPS}>
          <SentoriErrorBoundary
            fallback={({ error }) => <div>caught: {error.message}</div>}
          >
            <Boom />
          </SentoriErrorBoundary>
        </SentoriProvider>,
      )
    } finally {
      console.error = original
    }
    expect(screen.getByText('caught: boom-from-render')).toBeDefined()
  })
})
