import { Link } from 'react-router'

import { ThemeToggle } from './theme-toggle'

/**
 * Top app bar — editorial wordmark + center-anchored search trigger.
 *
 *   • h-12, paper bg with a single bottom hairline (no glass blur —
 *     the warmth of the paper palette doesn't want chrome)
 *   • Three-column grid (1fr / auto / 1fr) — search sits at the
 *     geometric center regardless of side-slot widths
 *   • SENTORI wordmark sits at Roboto Flex's readable axis (wdth 95,
 *     wght 600) + a tora-orange terminal dot — letter-spacing carries
 *     the wordmark weight, not bold
 *   • Right: theme toggle
 */
export function Toolbar() {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-[color:var(--rule)] bg-[color:var(--paper)] px-5">
      <Link className="justify-self-start" to="/" aria-label="Sentori — home">
        <span
          className="text-[color:var(--ink)] uppercase"
          style={{
            fontFamily: 'var(--font-sans)',
            fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
            fontSize: '15px',
            letterSpacing: '0.22em',
          }}
        >
          SENTORI
          <span
            className="ml-1.5 inline-block"
            style={{
              width: '6px',
              height: '6px',
              background: 'var(--accent)',
              borderRadius: '50%',
              transform: 'translateY(-1px)',
            }}
            aria-hidden
          />
        </span>
      </Link>

      <button
        className="flex w-[min(30rem,42vw)] items-center gap-3 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 py-1.5 text-[color:var(--ink-muted)] transition-colors hover:border-[color:var(--ink-soft)] hover:text-[color:var(--ink-soft)]"
        onClick={openCmdKPalette}
        type="button"
      >
        <span className="flex-1 truncate text-left text-[13px]">
          Search issue / trace / release…
        </span>
        <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase md:inline">
          ⌘K
        </span>
      </button>

      <div className="flex items-center gap-3 justify-self-end">
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Simulate Cmd+K so the existing self-contained <CmdK /> opens. */
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
