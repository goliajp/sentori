import { useEffect, useState } from 'react'

import { useAuth } from '@/auth/state'
import { VERSION_LABEL } from '@/version'

/**
 * Footer status bar — editorial micro-strip. Tora-orange version
 * tag + ingest health dot + clock, all-mono, paper background. Vertical
 * hairlines between segments to keep the eye organised in a 32px strip.
 */
export function StatusBar() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const handle = user?.email?.split('@')[0] ?? null

  return (
    <footer className="border-border bg-bg flex h-8 shrink-0 items-center border-t px-5 font-mono text-[11px]">
      <Cell>
        <span className="text-accent mr-2 tracking-[0.18em] uppercase">build</span>
        <span className="text-fg-secondary tabular-nums">{VERSION_LABEL}</span>
      </Cell>
      <Cell hideOnNarrow>
        <span className="text-fg-secondary inline-flex items-center gap-1.5">
          <span className="sentori-live-pulse bg-accent h-1.5 w-1.5 rounded-full" />
          <span className="tracking-[0.1em]">ingest healthy</span>
        </span>
      </Cell>
      <div className="ml-auto flex items-center">
        {handle && (
          <Cell>
            <span className="text-accent">@{handle}</span>
          </Cell>
        )}
        <Cell last>
          <span className="text-fg-secondary tabular-nums">
            {now.toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </Cell>
      </div>
    </footer>
  )
}

function Cell({
  children,
  hideOnNarrow,
  last,
}: {
  children: React.ReactNode
  hideOnNarrow?: boolean
  last?: boolean
}) {
  return (
    <div
      className={`flex items-center px-4 first:pl-0 ${
        last ? 'pr-0' : 'border-border-muted border-r'
      } ${hideOnNarrow ? 'hidden md:flex' : ''}`}
    >
      {children}
    </div>
  )
}
