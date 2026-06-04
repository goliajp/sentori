import { StatusBarComponent } from '@goliapkg/gds'
import { useEffect, useState } from 'react'

import { useAuth } from '@/auth/state'
import { VERSION_LABEL } from '@/version'

/**
 * Footer status bar — GDS `StatusBarComponent` driven by a four-item
 * array (build, ingest, user, clock). GDS handles separator + spacing
 * + density (rail height follows the active density axis). Items
 * gracefully hide on narrow viewports through Tailwind responsive
 * utilities — `hidden md:inline-flex` for the ingest pulse so a
 * narrow window keeps `build` + `clock` visible.
 */
export function StatusBar() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const handle = user?.email?.split('@')[0] ?? null

  const items: React.ReactNode[] = [
    <span className="inline-flex items-center gap-2 font-mono text-[11px]" key="build">
      <span className="text-accent tracking-[0.18em] uppercase">build</span>
      <span className="text-fg-secondary tabular-nums">{VERSION_LABEL}</span>
    </span>,
    <span
      className="text-fg-secondary hidden items-center gap-1.5 font-mono text-[11px] md:inline-flex"
      key="ingest"
    >
      <span className="sentori-live-pulse bg-accent h-1.5 w-1.5 rounded-full" />
      <span className="tracking-[0.1em]">ingest healthy</span>
    </span>,
    handle ? (
      <span className="text-accent font-mono text-[11px]" key="handle">
        @{handle}
      </span>
    ) : null,
    <span className="text-fg-secondary font-mono text-[11px] tabular-nums" key="clock">
      {now.toLocaleTimeString('en-US', { hour12: false })}
    </span>,
  ].filter(Boolean)

  return <StatusBarComponent items={items} />
}
