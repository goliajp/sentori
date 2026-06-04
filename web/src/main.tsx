// GDS token + theme CSS is `@import`-ed from inside index.css so
// Tailwind v4 can resolve the @theme blocks against the same file
// layer that `@source` scans GDS's dist for utility usage. Loading
// them from JS instead puts them in a different layer and Tailwind
// can't generate the right utilities.
import './index.css'

import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { DEFAULT_THEME, loadPersistedTheme, resolveThemeCssVars } from '@goliapkg/gds/systems'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'

import { createPersister } from '@/lib/query-persistence'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { DashboardLegacyRedirect } from './auth/DashboardLegacyRedirect'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { ROUTED_MODULES } from './modules/registry'
import { AccountView } from './views/account'
import { ForgotPasswordView } from './views/forgot-password'
import { InviteAcceptView } from './views/invite-accept'
import { LoginView } from './views/login'
import { OnboardingView } from './views/onboarding'
import { OrgLayout } from './views/org-layout'
import { RegisterView } from './views/register'
import { ResetPasswordView } from './views/reset-password'
import { RootRedirect } from './views/root-redirect'
import {
  SuperadminLayout,
  SuperadminOrgsView,
  SuperadminProjectsView,
  SuperadminUsersView,
} from './views/superadmin'
import { TransferAcceptView } from './views/transfer-accept'
import { UserActivityView } from './views/user-activity'
import { VerifyView } from './views/verify'

/**
 * Phase 17 sub-F: dogfood. Reports dashboard's own JS errors back to
 * the same Sentori instance under the `sentori-dashboard` project.
 * When VITE_SENTORI_TOKEN is unset (dev runs without a token), the
 * provider gets a placeholder config — init fails fast inside its own
 * try/catch and no events ship because the ingest URL is unreachable.
 */
const sentoriToken = import.meta.env.VITE_SENTORI_TOKEN
const sentoriConfig = {
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
  ingestUrl: sentoriToken
    ? (import.meta.env.VITE_SENTORI_INGEST ?? 'https://ingest.sentori.golia.jp')
    : 'http://127.0.0.1:0',
  release: `dashboard@${import.meta.env.VITE_GIT_SHA ?? '0.0.0'}`,
  token: sentoriToken ?? 'st_pk_unconfigured00000000000',
}

// Pre-render GDS theme CSS vars before React mounts to avoid FOUC.
// `loadPersistedTheme()` returns the user's last saved 5-axis theme
// (mode/density/elevation/glass/motion/shape) from localStorage, or
// null on first visit. `resolveThemeCssVars()` materializes those
// axes to a flat `{ '--gds-bg': '#...', '--gds-fg': '#...', ... }`
// map that we paint onto <html> in one synchronous pass — `<App>`
// then mounts with the right colors already on the document, and
// `useThemeEffect()` (inside <AppShell>) takes over for reactive
// updates when the user toggles theme later.
{
  // Sentori first-time default = dark mode + compact density. GDS is
  // dark-native (one of its ten design principles — light mode is a
  // derived adaptation), and 30+ minutes staring at a data-dense
  // dashboard in light mode is tangibly more tiring than dark, even
  // though both technically render correctly. Marketing
  // (sentori.golia.jp) and golia.jp main site also default dark, so
  // the cross-surface experience stays consistent. Users who prefer
  // light or system can flip via the ModeToggle in the top nav; the
  // choice persists via persistTheme() and overrides this default on
  // every subsequent visit.
  const saved = loadPersistedTheme() ?? { ...DEFAULT_THEME, mode: 'dark', density: 'compact' }
  const mode =
    saved.mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : saved.mode
  const vars = resolveThemeCssVars(saved, mode)
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.dataset.theme = mode
}

/**
 * Modules with `children` get a NESTED route so the parent renders
 * <Outlet /> and child views appear inside the parent's layout. This
 * lets Issues / Traces show a master-detail (rail on left, detail on
 * right) instead of jumping between separate full-page screens.
 */
const moduleChildren = ROUTED_MODULES.map((m) => {
  const View = m.view
  if (!m.children || m.children.length === 0) {
    return { element: <View />, path: m.path }
  }
  return {
    children: m.children.map((c) => {
      const Child = c.view
      return { element: <Child />, path: c.path }
    }),
    element: <View />,
    path: m.path,
  }
})

// v2.4 — single-domain routing. The SPA now lives at:
//
//   /login, /register, /verify, /forgot-password,
//   /reset-password/:token, /invite/:token, /transfers/:token
//                                          ← auth & accept routes at root
//   /main, /main/*                         ← logged-in dashboard
//
// Other paths on sentori.golia.jp are served by the marketing site
// (root /) and the docs site (/docs/*); Caddy routes those before
// reaching the SPA bundle. The SPA's catch-all redirects unknown
// paths to /main (which then routes to login if the user isn't
// authenticated).
const router = createBrowserRouter([
  { element: <LoginView />, path: '/login' },
  { element: <RegisterView />, path: '/register' },
  { element: <VerifyView />, path: '/verify' },
  { element: <ForgotPasswordView />, path: '/forgot-password' },
  { element: <ResetPasswordView />, path: '/reset-password/:token' },
  { element: <InviteAcceptView />, path: '/invite/:token' },
  { element: <TransferAcceptView />, path: '/transfers/:token' },
  {
    children: [
      { element: <RootRedirect />, index: true },
      { element: <OnboardingView />, path: 'onboarding' },
      { element: <AccountView />, path: 'account' },
      { element: <UserActivityView />, path: 'me/activity' },
      {
        children: [
          { element: <Navigate replace to="users" />, index: true },
          { element: <SuperadminUsersView />, path: 'users' },
          { element: <SuperadminOrgsView />, path: 'orgs' },
          { element: <SuperadminProjectsView />, path: 'projects' },
        ],
        element: <SuperadminLayout />,
        path: 'superadmin',
      },
      {
        children: [{ element: <Navigate replace to="overview" />, index: true }, ...moduleChildren],
        element: <OrgLayout />,
        path: 'org/:slug',
      },
      { element: <Navigate replace to="/main" />, path: '*' },
    ],
    element: <ProtectedLayout />,
    path: '/main',
  },
  // Anything else (e.g. someone deep-links into the dashboard at the
  // old root path /org/<slug>/issues from a v2.3-era bookmark) → bounce
  // to /main + same path, preserving the deep link. ProtectedLayout
  // then decides whether they're logged in. Legacy roots covered:
  // /org/*, /account, /me/*, /superadmin*, /onboarding, /projects, etc.
  { element: <DashboardLegacyRedirect />, path: '*' },
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 60_000,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

// F3 — react-query L2 persistence. Opt-in via meta.persist on the
// query; queries not opted in stay L1-only and rehydrate from
// network on cold load. Per architecture-standards.md §2.
const persister = createPersister(
  typeof window !== 'undefined' ? window.localStorage : memoryStorage()
)

/** Stub for SSR / test contexts where window.localStorage is absent. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentoriProvider config={sentoriConfig}>
      <SentoriErrorBoundary
        fallback={
          <div className="bg-bg text-fg t-md flex h-full items-center justify-center">
            Dashboard crashed. Refresh the page or contact support.
          </div>
        }
      >
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            buster: 'sentori:v1',
            maxAge: 24 * 60 * 60 * 1000,
            persister,
          }}
        >
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </PersistQueryClientProvider>
      </SentoriErrorBoundary>
    </SentoriProvider>
  </StrictMode>
)
