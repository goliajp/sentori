import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Attachment } from '@/api/client'

import { AttachmentGallery } from './AttachmentGallery'

const screenshot = (ref: string, source: Attachment['source'] = 'js'): Attachment => ({
  kind: 'screenshot',
  mediaType: 'image/jpeg',
  ref,
  sizeBytes: 1234,
  source,
})

const viewTree = (ref: string): Attachment => ({
  kind: 'viewTree',
  mediaType: 'application/json',
  ref,
  sizeBytes: 500,
  source: 'js',
})

describe('<AttachmentGallery>', () => {
  it('renders nothing for an empty / absent attachment list', () => {
    const { container } = render(<AttachmentGallery attachments={[]} eventId="e1" />)
    expect(container.firstChild).toBeNull()
    const { container: c2 } = render(<AttachmentGallery attachments={undefined} eventId="e1" />)
    expect(c2.firstChild).toBeNull()
  })

  it('renders screenshot thumbnails as clickable buttons', () => {
    render(
      <AttachmentGallery
        attachments={[screenshot('r-1'), screenshot('r-2', 'ios')]}
        eventId="e1"
      />
    )
    const thumbs = screen.getAllByRole('button', { name: /Screenshot/i })
    expect(thumbs).toHaveLength(2)
    const imgs = screen.getAllByAltText('Crash screenshot')
    expect(imgs[0]?.getAttribute('src')).toContain('/admin/api/events/e1/attachments/r-1')
    expect(imgs[0]?.getAttribute('loading')).toBe('lazy')
  })

  it('renders non-image attachments as pill links to the raw blob', () => {
    render(<AttachmentGallery attachments={[viewTree('r-3')]} eventId="evX" />)
    const link = screen.getByText('viewTree').closest('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('/admin/api/events/evX/attachments/r-3')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('opens a lightbox on screenshot click, closes on Esc', () => {
    render(<AttachmentGallery attachments={[screenshot('r-1')]} eventId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: /Screenshot/i })[0]!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('arrow-key steps through screenshots in the lightbox', () => {
    render(
      <AttachmentGallery
        attachments={[screenshot('r-a'), screenshot('r-b'), screenshot('r-c')]}
        eventId="e1"
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: /Screenshot/i })[0]!)
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    // wraps around
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('downloads from the same blob URL', () => {
    render(<AttachmentGallery attachments={[screenshot('r-d')]} eventId="ev9" />)
    fireEvent.click(screen.getAllByRole('button', { name: /Screenshot/i })[0]!)
    const dl = screen.getByText(/download/i)
    expect(dl.getAttribute('href')).toBe('/admin/api/events/ev9/attachments/r-d')
    expect(dl.hasAttribute('download')).toBe(true)
  })
})
