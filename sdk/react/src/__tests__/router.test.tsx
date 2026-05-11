import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Link, MemoryRouter, Route, Routes } from 'react-router'

import { clearBreadcrumbs, getBreadcrumbs } from '@goliapkg/sentori-javascript'

import { useSentoriRouter } from '../router.js'
import { SentoriProvider } from '../SentoriProvider.js'

const PROVIDER_PROPS = {
  config: {
    environment: 'test',
    ingestUrl: 'http://localhost:0',
    release: 'test@0.0.0',
    token: 'st_pk_testtesttesttesttesttesttest',
  },
}

function Shell() {
  useSentoriRouter()
  return (
    <>
      <Link to="/orders">orders</Link>
      <Link to="/billing">billing</Link>
      <Routes>
        <Route element={<div>home</div>} path="/" />
        <Route element={<div>orders-page</div>} path="/orders" />
        <Route element={<div>billing-page</div>} path="/billing" />
      </Routes>
    </>
  )
}

describe('useSentoriRouter', () => {
  beforeEach(() => clearBreadcrumbs())
  afterEach(() => {
    cleanup()
    clearBreadcrumbs()
  })

  test('initial mount does NOT emit a nav breadcrumb', () => {
    render(
      <SentoriProvider {...PROVIDER_PROPS}>
        <MemoryRouter initialEntries={['/']}>
          <Shell />
        </MemoryRouter>
      </SentoriProvider>,
    )
    expect(screen.getByText('home')).toBeDefined()
    expect(getBreadcrumbs().filter((b) => b.type === 'nav')).toHaveLength(0)
  })

  test('navigation emits a nav breadcrumb with from/to', () => {
    render(
      <SentoriProvider {...PROVIDER_PROPS}>
        <MemoryRouter initialEntries={['/']}>
          <Shell />
        </MemoryRouter>
      </SentoriProvider>,
    )

    fireEvent.click(screen.getByText('orders'))
    expect(screen.getByText('orders-page')).toBeDefined()

    const navs = getBreadcrumbs().filter((b) => b.type === 'nav')
    expect(navs).toHaveLength(1)
    expect(navs[0]?.data).toEqual({ from: '/', to: '/orders' })

    fireEvent.click(screen.getByText('billing'))
    expect(screen.getByText('billing-page')).toBeDefined()

    const navsAfter = getBreadcrumbs().filter((b) => b.type === 'nav')
    expect(navsAfter).toHaveLength(2)
    expect(navsAfter[1]?.data).toEqual({ from: '/orders', to: '/billing' })
  })
})
