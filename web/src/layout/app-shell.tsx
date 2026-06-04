import { ToggleGroup, useFonts } from '@goliapkg/gds'
import type { ThemeMode } from '@goliapkg/gds/systems'
import {
  loadPersistedTheme,
  useSetThemeDensity,
  useSetThemeMode,
  useTheme,
  useThemeEffect,
} from '@goliapkg/gds/systems'
import { useEffect } from 'react'
import { Link, Outlet } from 'react-router'

import { AccountMenu } from '@/components/account-menu'
import { CmdK } from '@/components/CmdK'
import { GoChord } from '@/components/GoChord'
import { NotificationBell } from '@/components/notification-bell'
import { StatusBar } from '@/components/status-bar'
import { VerifyBanner } from '@/components/verify-banner'

import { Sidebar } from './sidebar'

/**
 * Sentori shell — GDS-idiomatic layout.
 *
 *   skip-nav
 *   verify-banner (host email unverified)
 *   ┌─ NavBar ──────────────────────────────────────────────────┐
 *   │  SENTORI ● v1.x       search ⌘K        🔔 ☀/◐/☾ avatar    │
 *   ├─ Sidebar ──┬─ main (gds-pad, density-aware) ──────────────┤
 *   │  context   │                                              │
 *   │  Overview  │       <Outlet />                             │
 *   │  Find Bug  │                                              │
 *   │  …         │                                              │
 *   └────────────┴──────────────────────────────────────────────┘
 *   StatusBar (GDS StatusBarComponent — version · ingest · clock)
 *
 * Theme: GDS owns colors, spacing, density. AppShell mounts the
 * runtime (useThemeEffect + useFonts) and primes first-visit
 * defaults (mode=system, density=compact). Persisted user choices
 * always win on subsequent loads.
 */
export function AppShell() {
  useThemeEffect()
  useFonts()

  const setMode = useSetThemeMode()
  const setDensity = useSetThemeDensity()
  useEffect(() => {
    if (loadPersistedTheme() === null) {
      // First-time visitors land on dark + compact. See main.tsx for
      // the rationale (GDS is dark-native; light mode is the
      // derived-adaptation surface; marketing + main site default
      // dark too).
      setMode('dark')
      setDensity('compact')
    }
  }, [setMode, setDensity])

  return (
    <div className="bg-bg text-fg flex h-full flex-col">
      <a className="skip-to-content" href="#sentori-main">
        Skip to content
      </a>
      <VerifyBanner />
      <NavBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="bg-bg min-w-0 flex-1 overflow-y-auto" id="sentori-main">
          <div className="gds-pad h-full min-h-0">
            <Outlet />
          </div>
        </main>
      </div>
      <StatusBar />
      <CmdK />
      <GoChord />
    </div>
  )
}

/**
 * Top NavBar — three-column grid (brand / search / actions). Brand
 * left, CmdK trigger centered, actions (notifications + theme +
 * account) right-aligned. Sits flush against the viewport edge with
 * a bottom hairline; no sticky behaviour (the body owns scroll).
 */
function NavBar() {
  return (
    <header className="bg-bg-secondary border-border gds-h-lg grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b px-5">
      <Link className="justify-self-start" to="/" aria-label="Sentori — home">
        <span className="text-fg text-[15px] font-semibold tracking-[0.22em] uppercase">
          SENTORI
          <span
            aria-hidden
            className="bg-accent ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
          />
        </span>
      </Link>

      <button
        className="bg-bg border-border text-fg-muted hover:border-border-strong hover:text-fg gds-h-sm gds-pad-x-sm flex w-[min(30rem,42vw)] items-center gap-3 border transition-colors"
        onClick={openCmdKPalette}
        type="button"
      >
        <span className="flex-1 truncate text-left text-[13px]">
          Search issue / trace / release…
        </span>
        <span className="text-fg-muted hidden shrink-0 font-mono text-[10px] tracking-[0.1em] uppercase md:inline">
          ⌘K
        </span>
      </button>

      <div className="flex items-center gap-2 justify-self-end">
        <NotificationBell />
        <ModeToggle />
        <AccountMenu />
      </div>
    </header>
  )
}

/**
 * Three-mode theme switcher (light / system / dark). GDS ships a
 * 2-mode ThemeToggle; this wrapper preserves the `system` axis
 * value by going through ToggleGroup directly.
 */
const MODE_ITEMS: { value: ThemeMode; label: React.ReactNode }[] = [
  { value: 'light', label: <ModeIcon kind="light" /> },
  { value: 'system', label: <ModeIcon kind="system" /> },
  { value: 'dark', label: <ModeIcon kind="dark" /> },
]

function ModeToggle() {
  const theme = useTheme()
  const setMode = useSetThemeMode()
  return (
    <ToggleGroup
      aria-label="Theme mode"
      exclusive
      items={MODE_ITEMS}
      onChange={(v) => {
        const next = v[0] as ThemeMode | undefined
        if (next) setMode(next)
      }}
      size="sm"
      value={[theme.mode]}
    />
  )
}

function ModeIcon({ kind }: { kind: 'light' | 'system' | 'dark' }) {
  if (kind === 'light') {
    return (
      <svg aria-label="Light" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM17 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 17 10ZM2 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 10ZM10 17a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 17ZM15.657 15.657a.75.75 0 0 1 0-1.06l1.06-1.061a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0ZM3.283 4.343a.75.75 0 0 1 0-1.06l1.06-1.061a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0ZM15.657 4.343a.75.75 0 0 1 1.06-1.06l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06ZM3.283 15.657a.75.75 0 0 1 1.06-1.06l1.061 1.06a.75.75 0 1 1-1.06 1.061l-1.061-1.06Z" />
      </svg>
    )
  }
  if (kind === 'dark') {
    return (
      <svg aria-label="Dark" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path
          clipRule="evenodd"
          d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z"
          fillRule="evenodd"
        />
      </svg>
    )
  }
  return (
    <svg aria-label="System" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path
        clipRule="evenodd"
        d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 0 1.1 1.677A.75.75 0 0 1 13.26 18H6.74a.75.75 0 0 1-.484-1.323A3.501 3.501 0 0 0 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Zm1.5 0a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75v-7.5Z"
        fillRule="evenodd"
      />
    </svg>
  )
}

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
