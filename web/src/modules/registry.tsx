import { Suspense, lazy, type ComponentType } from 'react'

/**
 * v2.1 — every module loads on-demand via React.lazy() + Suspense.
 *
 * Before: all 18 modules + their detail views were eagerly imported
 * here, so the initial JS bundle the dashboard ships to a fresh user
 * carried code for every page (Integrations 1252 LOC, Posture 652,
 * Audience 605, Settings 556, plus 14 others) even when the user
 * only hit Overview. With per-route lazy loading the initial bundle
 * is roughly the layout + Overview, and other modules stream in as
 * the user navigates.
 *
 * Each `lazyView` returns a wrapped component that already has its
 * own Suspense fallback, so the router (main.tsx) doesn't need a
 * tree-wide Suspense — every navigation gets its own bounded
 * loading state. The fallback is intentionally tiny (a single
 * "Loading…" line) so a fast chunk fetch doesn't flash a heavy
 * skeleton.
 *
 * NEVER rule: dynamic import failures (network blip / cache poison)
 * are surfaced via React's existing error boundary chain — the
 * dashboard stays mounted; only the failed page shows the boundary
 * fallback. See SentoriErrorBoundary in main.tsx for the catch.
 */
function lazyView(loader: () => Promise<{ default: ComponentType }>): ComponentType {
  const Lazy = lazy(loader)
  return function LazyRouteView() {
    return (
      <Suspense
        fallback={
          <div className="sentori-page-in">
            <div className="border-y border-[color:var(--rule)] py-6 text-center font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              Loading…
            </div>
          </div>
        }
      >
        <Lazy />
      </Suspense>
    )
  }
}

const AlertsView = lazyView(() => import('./alerts/view').then((m) => ({ default: m.AlertsView })))
const AudienceView = lazyView(() =>
  import('./audience/view').then((m) => ({ default: m.AudienceView }))
)
const AuditLogView = lazyView(() =>
  import('./audit/view').then((m) => ({ default: m.AuditLogView }))
)
const CertMonitorView = lazyView(() =>
  import('./cert-monitor/view').then((m) => ({ default: m.CertMonitorView }))
)
const IntegrationsView = lazyView(() =>
  import('./integrations/view').then((m) => ({ default: m.IntegrationsView }))
)
const IssueDetailView = lazyView(() =>
  import('./issues/detail-view').then((m) => ({ default: m.IssueDetailView }))
)
const IssuesView = lazyView(() => import('./issues/view').then((m) => ({ default: m.IssuesView })))
const LiveDebugView = lazyView(() =>
  import('./live-debug/view').then((m) => ({ default: m.LiveDebugView }))
)
const MetricsView = lazyView(() =>
  import('./metrics/view').then((m) => ({ default: m.MetricsView }))
)
const MomentsView = lazyView(() =>
  import('./moments/view').then((m) => ({ default: m.MomentsView }))
)
const PostureView = lazyView(() =>
  import('./posture/view').then((m) => ({ default: m.PostureView }))
)
const PrivacyView = lazyView(() =>
  import('./privacy/view').then((m) => ({ default: m.PrivacyView }))
)
const OverviewView = lazyView(() =>
  import('./overview/view').then((m) => ({ default: m.OverviewView }))
)
const ProjectIntegrationView = lazyView(() =>
  import('../views/project-integration').then((m) => ({ default: m.ProjectIntegrationView }))
)
const ReleaseDetailView = lazyView(() =>
  import('./releases/detail-view').then((m) => ({ default: m.ReleaseDetailView }))
)
const ReleasesView = lazyView(() =>
  import('./releases/view').then((m) => ({ default: m.ReleasesView }))
)
const WebhooksView = lazyView(() =>
  import('./webhooks/view').then((m) => ({ default: m.WebhooksView }))
)
const SettingsView = lazyView(() =>
  import('./settings/view').then((m) => ({ default: m.SettingsView }))
)
const TeamsView = lazyView(() => import('./teams/view').then((m) => ({ default: m.TeamsView })))
const TraceDetailView = lazyView(() =>
  import('./traces/detail-view').then((m) => ({ default: m.TraceDetailView }))
)
const TracesView = lazyView(() => import('./traces/view').then((m) => ({ default: m.TracesView })))
const VitalsView = lazyView(() => import('./vitals/view').then((m) => ({ default: m.VitalsView })))
const UsersView = lazyView(() => import('./users/view').then((m) => ({ default: m.UsersView })))
const UserDetailView = lazyView(() =>
  import('./users/detail-view').then((m) => ({ default: m.UserDetailView }))
)

export type ModuleGroup = 'monitor' | 'organize'

export type ModuleChildRoute = { path: string; view: ComponentType }

export type ModuleDef = {
  children?: ModuleChildRoute[]
  /** Single-letter or stroke icon — short enough to fit in a 16px box */
  iconPath: string
  id: string
  label: string
  path: string
  /** null = pinned at top, no group header */
  group: ModuleGroup | null
  view: ComponentType
  adminOnly?: boolean
  /** When true the module is excluded from sidebar + routing.
   *  Use for surfaces that aren't UX-complete yet — keeps the
   *  published dashboard from showing half-finished pages. The
   *  view file stays in the tree; flip this off once the polish
   *  lands. */
  hidden?: boolean
}

export const GROUPS: { id: ModuleGroup; label: string }[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'organize', label: 'Organize' },
]

export const MODULES: ModuleDef[] = [
  {
    group: null,
    iconPath: 'M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z',
    id: 'overview',
    label: 'Overview',
    path: 'overview',
    view: OverviewView,
  },
  {
    children: [{ path: ':issueId', view: IssueDetailView }],
    group: 'monitor',
    iconPath:
      'M10.3 3.3a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H3.99a2 2 0 0 1-1.7-3zM12 9v4M12 17h.01',
    id: 'issues',
    label: 'Issues',
    path: 'issues',
    view: IssuesView,
  },
  {
    children: [{ path: ':traceId', view: TraceDetailView }],
    group: 'monitor',
    // v2.2 reset — hidden while we redesign the surface from scratch.
    // The trace data continues to flow into the DB; the view is just
    // off the sidebar so the dashboard advertises only what we ship
    // a polished UI for. Flip back on once the redesigned Traces
    // module lands. See plans/v2.2.md.
    hidden: true,
    iconPath: 'M3 6h18M3 12h13M3 18h9',
    id: 'traces',
    label: 'Traces',
    path: 'traces',
    view: TracesView,
  },
  // v2.2 reset — every Monitor-group module besides Issues is hidden
  // while we redesign each surface from a "what data do we actually
  // have + what is the operator's job at this view" first-principles
  // perspective. None of the underlying SDK ingest is turned off; the
  // dashboard simply only advertises modules that ship a polished UI.
  // Bring each one back when it's ready, with `hidden: false` and
  // (probably) a fresh view. See plans/v2.2.md for the redesign plan.
  {
    group: 'monitor',
    hidden: true,
    iconPath: 'M4 20V10M10 20V4M16 20V14M22 20H2',
    id: 'metrics',
    label: 'Metrics',
    path: 'metrics',
    view: MetricsView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath: 'M12 14l4-4M3 12a9 9 0 1 1 18 0M5 12a7 7 0 0 1 14 0',
    id: 'vitals',
    label: 'Vitals',
    path: 'vitals',
    view: VitalsView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath: 'M3 3h18l-7 8v8l-4-2v-6L3 3z',
    id: 'moments',
    label: 'Moments',
    path: 'moments',
    view: MomentsView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    id: 'audience',
    label: 'Audience',
    path: 'audience',
    view: AudienceView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    id: 'cert-monitor',
    label: 'Cert monitor',
    path: 'cert-monitor',
    view: CertMonitorView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath: 'M6 12h12M12 6v12M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0M9 9h6v6H9z',
    id: 'posture',
    label: 'Posture',
    path: 'posture',
    view: PostureView,
  },
  {
    group: 'monitor',
    hidden: true,
    iconPath:
      'M2 2l20 20M6.7 6.7C4 8.4 2.6 11 2.6 12c0 2 3 6 9.4 6 2.1 0 3.8-.4 5.2-1M11 5c.3 0 .7 0 1 .1M21.4 12c0-2-3-6-9.4-6',
    id: 'privacy',
    label: 'Privacy',
    path: 'privacy',
    view: PrivacyView,
  },
  {
    adminOnly: true,
    group: 'monitor',
    hidden: true,
    iconPath:
      'M4.9 19.1A9 9 0 0 1 4.9 4.9M19.1 4.9a9 9 0 0 1 0 14.2M7.8 16.2A5 5 0 0 1 7.8 7.8M16.2 7.8a5 5 0 0 1 0 8.4M12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM12 22v-9',
    id: 'live-debug',
    label: 'Live debug',
    path: 'live-debug',
    view: LiveDebugView,
  },
  {
    children: [{ path: ':release', view: ReleaseDetailView }],
    group: 'monitor',
    // v2.2 — first re-opened module under the "find-bug" lens.
    // Backed by the `/explore` query endpoint with a preset query
    // ({dim: release, measures: [event_count, issue_count, ...]}).
    iconPath:
      'm12.83 2.18 7 3.12A2 2 0 0 1 21 7.12v9.76a2 2 0 0 1-1.17 1.82l-7 3.12a2 2 0 0 1-1.66 0l-7-3.12A2 2 0 0 1 3 16.88V7.12A2 2 0 0 1 4.17 5.3l7-3.12a2 2 0 0 1 1.66 0M3.3 7l8.7 4 8.7-4M12 22V11',
    id: 'releases',
    label: 'Releases',
    path: 'releases',
    view: ReleasesView,
  },
  {
    // v2.3 — cross-project user lookup. Browser hashes raw value
    // (email / phone / oauth_sub) before send; URL state holds only
    // the hash. Server resolves to the org's default identity_scope
    // and queries identity_fingerprints for cross-project hits.
    // See `docs/design/sdk-v2.3-redesign.md` §5.
    group: 'monitor',
    iconPath:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 11a4 4 0 0 0-4-4M22 21v-2a4 4 0 0 0-3-3.87',
    children: [{ path: ':fingerprintHex', view: UserDetailView }],
    id: 'users',
    label: 'Users',
    path: 'users',
    view: UsersView,
  },
  {
    adminOnly: true,
    group: 'monitor',
    hidden: true,
    iconPath: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    id: 'alerts',
    label: 'Alerts',
    path: 'alerts',
    view: AlertsView,
  },
  {
    group: 'organize',
    iconPath:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    id: 'teams',
    label: 'Teams',
    path: 'teams',
    view: TeamsView,
  },
  {
    adminOnly: true,
    group: 'organize',
    iconPath:
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    id: 'integrations',
    label: 'Integrations',
    path: 'integrations',
    view: IntegrationsView,
  },
  {
    adminOnly: true,
    group: 'organize',
    iconPath: 'M22 12.5l-9-9-9 9 9 9zM12 6v6m0 0v6m0-6h6m-6 0H6',
    id: 'webhooks',
    label: 'Webhooks',
    path: 'webhooks',
    view: WebhooksView,
  },
  {
    adminOnly: true,
    group: 'organize',
    iconPath: 'M7 7h10M7 12h10M7 17h6M3 4h2M3 9h2M3 14h2M3 19h2',
    id: 'integrate',
    label: 'Integrate',
    path: 'integrate',
    view: ProjectIntegrationView,
  },
  {
    adminOnly: true,
    group: 'organize',
    iconPath:
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
    id: 'audit',
    label: 'Audit',
    path: 'audit',
    view: AuditLogView,
  },
  {
    group: 'organize',
    iconPath:
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    id: 'settings',
    label: 'Settings',
    path: 'settings',
    view: SettingsView,
  },
]

export function modulesInGroup(group: ModuleGroup): ModuleDef[] {
  return MODULES.filter((m) => m.group === group && !m.hidden)
}

/** Filter `MODULES` for routing — drops hidden modules everywhere
 *  so the router doesn't even register their paths. */
export const ROUTED_MODULES: ModuleDef[] = MODULES.filter((m) => !m.hidden)

export const PINNED_MODULE: ModuleDef = MODULES[0]
