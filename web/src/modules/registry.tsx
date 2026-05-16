import type { ComponentType } from 'react'

import { AlertsView } from './alerts/view'
import { AuditLogView } from './audit/view'
import { CertMonitorView } from './cert-monitor/view'
import { IntegrationsView } from './integrations/view'
import { IssueDetailView } from './issues/detail-view'
import { IssuesView } from './issues/view'
import { LiveDebugView } from './live-debug/view'
import { MetricsView } from './metrics/view'
import { MomentsView } from './moments/view'
import { PrivacyView } from './privacy/view'
import { OverviewView } from './overview/view'
import { ReleasesView } from './releases/view'
import { SettingsView } from './settings/view'
import { TeamsView } from './teams/view'
import { TraceDetailView } from './traces/detail-view'
import { TracesView } from './traces/view'
import { VitalsView } from './vitals/view'

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
    iconPath: 'M3 6h18M3 12h13M3 18h9',
    id: 'traces',
    label: 'Traces',
    path: 'traces',
    view: TracesView,
  },
  {
    group: 'monitor',
    // bar-chart-ish glyph: three rising bars
    iconPath: 'M4 20V10M10 20V4M16 20V14M22 20H2',
    id: 'metrics',
    label: 'Metrics',
    path: 'metrics',
    view: MetricsView,
  },
  {
    group: 'monitor',
    // gauge glyph
    iconPath: 'M12 14l4-4M3 12a9 9 0 1 1 18 0M5 12a7 7 0 0 1 14 0',
    id: 'vitals',
    label: 'Vitals',
    path: 'vitals',
    view: VitalsView,
  },
  {
    group: 'monitor',
    // funnel glyph
    iconPath: 'M3 3h18l-7 8v8l-4-2v-6L3 3z',
    id: 'moments',
    label: 'Moments',
    path: 'moments',
    view: MomentsView,
  },
  {
    group: 'monitor',
    // shield-with-check, security glyph
    iconPath: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    id: 'cert-monitor',
    label: 'Cert monitor',
    path: 'cert-monitor',
    view: CertMonitorView,
  },
  {
    group: 'monitor',
    // eye-with-slash, privacy/redaction glyph
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
    // radio-tower / broadcast glyph
    iconPath:
      'M4.9 19.1A9 9 0 0 1 4.9 4.9M19.1 4.9a9 9 0 0 1 0 14.2M7.8 16.2A5 5 0 0 1 7.8 7.8M16.2 7.8a5 5 0 0 1 0 8.4M12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM12 22v-9',
    id: 'live-debug',
    label: 'Live debug',
    path: 'live-debug',
    view: LiveDebugView,
  },
  {
    group: 'monitor',
    iconPath:
      'm12.83 2.18 7 3.12A2 2 0 0 1 21 7.12v9.76a2 2 0 0 1-1.17 1.82l-7 3.12a2 2 0 0 1-1.66 0l-7-3.12A2 2 0 0 1 3 16.88V7.12A2 2 0 0 1 4.17 5.3l7-3.12a2 2 0 0 1 1.66 0M3.3 7l8.7 4 8.7-4M12 22V11',
    id: 'releases',
    label: 'Releases',
    path: 'releases',
    view: ReleasesView,
  },
  {
    adminOnly: true,
    group: 'monitor',
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
  return MODULES.filter((m) => m.group === group)
}

export const PINNED_MODULE: ModuleDef = MODULES[0]
