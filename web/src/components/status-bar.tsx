import { useEffect, useState } from 'react'

import { useAuth } from '@/auth/state'
import { VERSION_LABEL } from '@/version'

/**
 * Footer status bar — always-visible system pulse.
 *
 * Three left-to-right segments separated by `gap-6` (no vertical hairlines —
 * those read as enterprise chrome on a 32px strip):
 *
 *   1. Version (footer-owns this — no other surface shows the version)
 *   2. System throughput + health (placeholder stub for now; the real
 *      values will land when we wire `recent.rs` SSE / `/admin/api/health`
 *      back here)
 *   3. Current user + live clock
 *
 * Anything that's already shown on the page is deliberately NOT shown
 * here. E.g. SENTORI is in the toolbar, env=prod lives in each view's
 * filter bar, alerts are a sidebar module.
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
    <footer className="border-border bg-bg-secondary text-fg-muted t-sm flex h-8 shrink-0 items-center gap-6 border-t px-4 font-mono">
      <span className="opacity-70">{VERSION_LABEL}</span>

      <span className="hidden items-center gap-1.5 md:flex">
        <span className="bg-success h-1.5 w-1.5 rounded-full" />
        ingest healthy
      </span>

      <span className="ml-auto flex items-center gap-3">
        {handle && <span className="text-accent">@{handle}</span>}
        <span className="tabular-nums">{now.toLocaleTimeString('en-US', { hour12: false })}</span>
      </span>
    </footer>
  )
}
