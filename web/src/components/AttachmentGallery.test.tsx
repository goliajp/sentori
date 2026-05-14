import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Attachment } from '@/api/client'

import { AttachmentGallery } from './AttachmentGallery'

// Phase 48 sub-A.2 — the gallery now fetches attachments directly from
// `/admin/api/events/<id>/attachments` instead of taking them as a
// prop. Stub `global.fetch` per test to drive the data the gallery
// sees, then wait for the react-query state to settle.

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function stubAttachments(rows: Attachment[]) {
  const fetchMock = vi.fn(async () => ({
    json: async () => rows,
    ok: true,
    status: 200,
  }))
  ;(globalThis as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

const screenshot = (ref: string, source: Attachment['source'] = 'js'): Attachment => ({
  kind: 'screenshot',
  mediaType: 'image/jpeg',
  ref,
  sizeBytes: 1234,
  source,
})

const stateSnapshot = (ref: string): Attachment => ({
  kind: 'stateSnapshot',
  mediaType: 'application/json',
  ref,
  sizeBytes: 500,
  source: 'js',
})

const originalFetch = globalThis.fetch
afterEach(() => {
  ;(globalThis as { fetch: typeof fetch }).fetch = originalFetch
})

describe('<AttachmentGallery>', () => {
  it('renders an explicit empty state when the server has no attachments', async () => {
    stubAttachments([])
    wrap(<AttachmentGallery eventId="e1" />)
    expect(await screen.findByText(/no attachments captured/i)).toBeInTheDocument()
  })

  it('renders screenshot thumbnails as clickable buttons', async () => {
    stubAttachments([screenshot('r-1'), screenshot('r-2', 'ios')])
    wrap(<AttachmentGallery eventId="e1" />)
    const thumbs = await screen.findAllByRole('button', { name: /Screenshot/i })
    expect(thumbs).toHaveLength(2)
    const imgs = screen.getAllByAltText('Crash screenshot')
    expect(imgs[0]?.getAttribute('src')).toContain('/admin/api/events/e1/attachments/r-1')
    expect(imgs[0]?.getAttribute('loading')).toBe('lazy')
  })

  it('renders non-image, non-tree attachments as pill links to the raw blob', async () => {
    stubAttachments([stateSnapshot('r-3')])
    wrap(<AttachmentGallery eventId="evX" />)
    const label = await screen.findByText('stateSnapshot')
    const link = label.closest('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('/admin/api/events/evX/attachments/r-3')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('renders viewTree attachments inline via <ViewTreePanel>', async () => {
    stubAttachments([
      {
        kind: 'viewTree',
        mediaType: 'application/json',
        ref: 'tree-1',
        sizeBytes: 200,
        source: 'ios',
      },
    ])
    wrap(<AttachmentGallery eventId="ev1" />)
    expect(await screen.findByText(/view tree at error/i)).toBeInTheDocument()
    // The single-tree case opens <details> automatically; the panel
    // kicks off its own fetch which our stub also satisfies, so we
    // just assert the panel header is wired up.
  })

  it('opens a lightbox on screenshot click, closes on Esc', async () => {
    stubAttachments([screenshot('r-1')])
    wrap(<AttachmentGallery eventId="e1" />)
    const thumb = (await screen.findAllByRole('button', { name: /Screenshot/i }))[0]!
    fireEvent.click(thumb)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('arrow-key steps through screenshots in the lightbox', async () => {
    stubAttachments([screenshot('r-a'), screenshot('r-b'), screenshot('r-c')])
    wrap(<AttachmentGallery eventId="e1" />)
    const thumbs = await screen.findAllByRole('button', { name: /Screenshot/i })
    fireEvent.click(thumbs[0]!)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('downloads from the same blob URL', async () => {
    stubAttachments([screenshot('r-d')])
    wrap(<AttachmentGallery eventId="ev9" />)
    const thumb = (await screen.findAllByRole('button', { name: /Screenshot/i }))[0]!
    fireEvent.click(thumb)
    const dl = screen.getByText(/download/i)
    expect(dl.getAttribute('href')).toBe('/admin/api/events/ev9/attachments/r-d')
    expect(dl.hasAttribute('download')).toBe(true)
  })
})
