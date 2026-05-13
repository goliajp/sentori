import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SourceCode } from './SourceCode'

// We don't await the starry-night singleton — it lazy-loads after
// mount via dynamic imports the jsdom env doesn't actually resolve.
// These assertions cover the fallback render path: plain text, line
// numbers, and the highlight overlay. Visual syntax colors are a
// runtime-only concern.

describe('<SourceCode>', () => {
  it('renders each line with its 1-indexed number', () => {
    render(<SourceCode code={'const a = 1\nconst b = 2\nconst c = 3'} language="typescript" />)
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('const a = 1')).toBeTruthy()
    expect(screen.getByText('const c = 3')).toBeTruthy()
  })

  it('respects `startLine` for line numbers', () => {
    render(<SourceCode code={'foo()\nbar()'} language="typescript" startLine={42} />)
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('43')).toBeTruthy()
  })

  it('applies the highlight class only to lines in `highlightLines`', () => {
    // startLine=10 → rendered as 10, 11, 12. Highlight 11 only.
    const { container } = render(
      <SourceCode code={'a\nb\nc'} highlightLines={[11]} language="typescript" startLine={10} />
    )
    const lines = container.querySelectorAll('pre > div')
    expect(lines.length).toBe(3)
    expect(lines[0]?.className).not.toContain('bg-red-500')
    expect(lines[1]?.className).toContain('bg-red-500')
    expect(lines[2]?.className).not.toContain('bg-red-500')
  })

  it('emits `<div id="prefixL42">` anchors when `lineAnchorPrefix` is set', () => {
    const { container } = render(
      <SourceCode code={'x\ny'} language="typescript" lineAnchorPrefix="frame3-" startLine={41} />
    )
    expect(container.querySelector('#frame3-L41')).toBeTruthy()
    expect(container.querySelector('#frame3-L42')).toBeTruthy()
  })

  it('hides the line-number column when `showLineNumbers` is false', () => {
    const { container } = render(
      <SourceCode code={'foo'} language="typescript" showLineNumbers={false} />
    )
    // Line number wrappers carry tabular-nums; with the column off,
    // none should be present.
    expect(container.querySelector('.tabular-nums')).toBe(null)
  })
})
