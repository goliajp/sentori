// v1.4 W29 — snapshot test for the project-wide + per-release nudge
// banner. Locks the rendered HTML so future refactors don't silently
// regress the messaging the operator depends on.
//
// We mock the two `adminApi` calls the banner makes (the project-wide
// summary + the per-release coverage probe) so the component runs end-
// to-end through useQuery without hitting the network. Three cases:
//
//   1. Project has zero releases → banner renders nothing.
//   2. Project has releases but no sourcemaps anywhere → project-wide
//      nudge ("No sourcemaps uploaded for this project's releases").
//   3. Project has sourcemaps but THIS release doesn't → v1.4 W27's
//      per-release nudge ("No sourcemap uploaded for release …").

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  adminApi: {
    sourceCoverage: vi.fn(),
    sourcemapStatus: vi.fn(),
  },
}))

import { adminApi } from '@/api/client'

import { SourceMapStatusBanner } from './source-map-status-banner'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('SourceMapStatusBanner', () => {
  test('renders nothing for a brand-new project', async () => {
    ;(adminApi.sourcemapStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      lastUploadedAt: null,
      releasesTotal: 0,
      releasesWithAndroidBundle: 0,
      releasesWithIosBundle: 0,
      releasesWithSourcemap: 0,
    })
    const { container } = wrap(<SourceMapStatusBanner platform="javascript" projectId="p1" />)
    // empty branch returns null
    expect(container.firstChild).toBeNull()
  })

  test('renders project-wide nudge when no sourcemap uploaded anywhere', async () => {
    ;(adminApi.sourcemapStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      lastUploadedAt: null,
      releasesTotal: 3,
      releasesWithAndroidBundle: 0,
      releasesWithIosBundle: 0,
      releasesWithSourcemap: 0,
    })
    const { findByText } = wrap(<SourceMapStatusBanner platform="javascript" projectId="p1" />)
    const banner = await findByText(/uploaded for this project/i)
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).toMatchSnapshot()
  })

  test("renders per-release nudge when project is healthy but this release isn't (W27)", async () => {
    ;(adminApi.sourcemapStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      lastUploadedAt: '2026-05-19T00:00:00Z',
      releasesTotal: 5,
      releasesWithAndroidBundle: 0,
      releasesWithIosBundle: 0,
      releasesWithSourcemap: 5,
    })
    ;(adminApi.sourceCoverage as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasAndroidBundle: false,
      hasIosBundle: false,
      hasJsSourcemap: false,
    })
    const { findByText } = wrap(
      <SourceMapStatusBanner platform="javascript" projectId="p1" release="myapp@1.2.3" />
    )
    const banner = await findByText(/uploaded for release/i)
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).toMatchSnapshot()
  })
})
