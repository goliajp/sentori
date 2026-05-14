import { Link } from 'react-router'

import { ThemeToggle } from './theme-toggle'

/**
 * Top app bar — tasks.golia.jp shape.
 *
 *   • h-12, glass via backdrop-blur
 *   • Three-column grid (1fr / auto / 1fr) so the search input sits at
 *     the geometric center of the viewport regardless of side-slot widths
 *   • Left: SENTORI wordmark (all-caps, wide tracking — treated as a
 *     brand glyph and intentionally outside the strict t-sm/t-md/t-lg
 *     scale)
 *   • Center: a button that opens the Cmd-K palette; clicking it
 *     simulates the Cmd+K keystroke so the existing <CmdK /> component
 *     (which owns its own open state) doesn't need refactoring
 *   • Right: theme toggle
 */
export function Toolbar() {
  return (
    <header className="border-border bg-bg/80 grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b px-4 backdrop-blur-xl">
      <Link className="text-fg justify-self-start" to="/">
        <span className="font-semibold" style={{ fontSize: '15px', letterSpacing: '0.22em' }}>
          SENTORI
        </span>
      </Link>

      <button
        className="border-border text-fg-muted hover:text-fg t-md flex w-[min(28rem,40vw)] items-center gap-2 rounded-md border bg-transparent px-3 py-1.5"
        onClick={openCmdKPalette}
        type="button"
      >
        <span className="flex-1 truncate text-left">Search issue / trace / release…</span>
        <span className="text-fg-muted hidden shrink-0 md:inline">⌘K · /</span>
      </button>

      <div className="flex items-center gap-2 justify-self-end">
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Simulate Cmd+K so the existing self-contained <CmdK /> opens.
 *  Dispatching a synthetic keydown is the lightest-touch way to trigger
 *  the palette without lifting its state into an atom (or rewriting it). */
function openCmdKPalette(): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'k',
      metaKey: true,
    })
  )
}
