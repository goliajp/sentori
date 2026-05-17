import { Outlet } from 'react-router'

import { CmdK } from '@/components/CmdK'
import { StatusBar } from '@/components/status-bar'
import { Toolbar } from '@/components/toolbar'
import { VerifyBanner } from '@/components/verify-banner'

import { Sidebar } from './sidebar'

/**
 * Five-piece shell — tasks.golia.jp shape.
 *
 *   Toolbar      (h-12, brand + search + theme)
 *   Sidebar | main  (flex row, main has `px-4 py-3`)
 *   StatusBar    (h-8, version + health + user/clock)
 */
export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <a className="skip-to-content" href="#sentori-main">
        Skip to content
      </a>
      <Toolbar />
      <VerifyBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto" id="sentori-main">
          {/* `h-full min-h-0` so child views with `h-full` (like
              IssuesView / TracesView, which want their two-panel
              master-detail to stick to the viewport edges instead of
              flowing past the StatusBar) get a real container height
              to fill. Views that don't request a fixed height continue
              to flow with `overflow-y-auto` on <main>. */}
          <div className="h-full min-h-0 px-4 py-3">
            <Outlet />
          </div>
        </main>
      </div>
      <StatusBar />
      <CmdK />
    </div>
  )
}
