import { Outlet } from 'react-router'

import { StatusBar } from '@/components/status-bar'
import { Toolbar } from '@/components/toolbar'

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
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto" id="sentori-main">
          <div className="px-4 py-3">
            <Outlet />
          </div>
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
