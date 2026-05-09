import { Link, Outlet, useLocation } from 'react-router'

import { useAuth } from './auth/state'
import { ThemeToggle } from './components/theme-toggle'
import { useThemeEffect } from './components/theme'

const NAV = [{ label: 'Issues', path: '/issues' }]

export function AppLayout() {
  useThemeEffect()
  const location = useLocation()
  const { logout } = useAuth()

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  return (
    <div className="flex h-full flex-col">
      <header className="border-border bg-bg/80 flex h-12 shrink-0 items-center justify-between border-b px-6 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <Link className="text-fg text-sm font-semibold" to="/">
            Sentori
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive(item.path)
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                }`}
                key={item.path}
                to={item.path}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-3 py-1.5 text-sm transition-colors"
            onClick={() => void logout()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
