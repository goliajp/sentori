import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { OrgRole, OrgRow } from '@/api/client'
import { DensityProvider } from '@/lib/density'

// ThemeToggle pulls in a jotai atomWithStorage that trips on the
// jsdom storage object during its first onMount. We're not testing
// the theme picker here, so stub it out — sidebar nav structure is
// what these tests assert.
vi.mock('./theme-toggle', () => ({
  ThemeToggle: () => null,
}))

import { Sidebar } from './sidebar'

const org = (role: OrgRole): OrgRow => ({
  createdAt: '2026-05-01T00:00:00Z',
  id: 'org-1',
  name: 'Acme',
  ownerId: 'u-1',
  role,
  slug: 'acme',
})

function wrap(ui: ReactNode, initialPath = '/org/acme/issues') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DensityProvider>
        <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
      </DensityProvider>
    </QueryClientProvider>
  )
}

const sidebar = (role: OrgRole, path?: string) =>
  wrap(
    <Sidebar
      currentOrg={org(role)}
      currentProject={null}
      currentTeamSlug={null}
      onLogout={() => {}}
      orgs={[org(role)]}
      teams={[]}
      user={{ email: 'dev@local' }}
    />,
    path
  )

describe('Sidebar', () => {
  it('renders the primary nav items', () => {
    sidebar('owner')
    // (rendered twice — desktop rail + the mobile aside is conditionally
    // mounted only when open, so each label appears once)
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^issues$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^traces$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^releases$/i })).toBeInTheDocument()
  })

  it('shows admin-only items for an admin/owner', () => {
    sidebar('admin')
    expect(screen.getByRole('link', { name: /^alerts$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^audit$/i })).toBeInTheDocument()
  })

  it('hides admin-only items for a non-admin member', () => {
    sidebar('member')
    expect(screen.queryByRole('link', { name: /^alerts$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^audit$/i })).not.toBeInTheDocument()
    // ...but the regular items are still there
    expect(screen.getByRole('link', { name: /^issues$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^teams$/i })).toBeInTheDocument()
  })

  it('marks the current route active', () => {
    sidebar('owner', '/org/acme/traces')
    const active = screen.getByRole('link', { name: /^traces$/i })
    expect(active.className).toContain('text-accent')
    expect(screen.getByRole('link', { name: /^issues$/i }).className).not.toContain('text-accent')
  })

  it('renders the user email + Sign out reachable through the account menu', async () => {
    sidebar('owner')
    expect(screen.getByText('dev@local')).toBeInTheDocument()
    // Phase 48 sub-D — Sign out moved into a popover behind the account
    // button so the sidebar footer never wraps. Click the account button
    // first to surface Sign out.
    const accountBtn = screen.getByRole('button', { name: /account menu/i })
    accountBtn.click()
    expect(await screen.findByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
  })
})
