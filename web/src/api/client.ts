const ADMIN_BASE = '/admin/api'
const AUTH_BASE = '/api/auth'

export type AdminApiError = {
  body: unknown
  status: number
}

async function apiFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${base}${path}`
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const resp = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  })
  if (!resp.ok) {
    let body: unknown
    try {
      body = await resp.json()
    } catch {
      body = await resp.text()
    }
    const err: AdminApiError = { body, status: resp.status }
    throw err
  }
  if (resp.status === 204) {
    return undefined as T
  }
  return (await resp.json()) as T
}

const ORGS_BASE = '/api'

const adminFetch = <T>(path: string, init?: RequestInit) => apiFetch<T>(ADMIN_BASE, path, init)
const authFetch = <T>(path: string, init?: RequestInit) => apiFetch<T>(AUTH_BASE, path, init)
const orgsFetch = <T>(path: string, init?: RequestInit) => apiFetch<T>(ORGS_BASE, path, init)

export type IssueStatus = 'active' | 'closed' | 'regressed' | 'resolved' | 'silenced'

export type IssueRow = {
  /** Phase 25 sub-F: NULL when nobody owns this issue. */
  assigneeEmail: null | string
  assigneeUserId: null | string
  errorType: string
  eventCount: number
  fingerprint: string
  firstSeen: string
  id: string
  lastEnvironment: null | string
  lastRelease: null | string
  lastSeen: string
  messageSample: string
  /** Phase 23 sub-D: set when the issue was resolved at some point. */
  regressedAt: null | string
  regressedInRelease: null | string
  resolvedAt: null | string
  resolvedInRelease: null | string
  status: IssueStatus
}

export type EventRow = {
  environment: string
  errorMessage: string
  errorType: string
  id: string
  occurredAt: string
  payload: ServerEvent
  platform: string
  receivedAt: string
  release: string
}

/** Mirrors the server's `event::Event` (the JSON we accept on /v1/events). */
export type ServerEvent = {
  app: {
    build?: string
    framework?: { name: string; version: string }
    version: string
  }
  breadcrumbs: Breadcrumb[]
  device: {
    locale?: string
    model?: string
    os: string
    osVersion: string
  }
  environment: string
  error: SentoriError
  fingerprint: string[]
  id: string
  kind: 'anr' | 'error'
  platform: 'android' | 'ios' | 'javascript'
  release: string
  spanId: null | string
  tags: Record<string, string>
  timestamp: string
  traceId: null | string
  user: null | { anonymous?: boolean; id?: string }
}

export type SentoriError = {
  cause: null | SentoriError
  message: string
  stack: Frame[]
  type: string
}

export type Frame = {
  absolutePath?: string
  column?: number
  file: string
  function?: string
  inApp: boolean
  line: number
}

export type Breadcrumb = {
  data: Record<string, unknown>
  timestamp: string
  type: 'custom' | 'log' | 'nav' | 'net' | 'user'
}

export const adminApi = {
  issueDetail: (projectId: string, issueId: string) =>
    adminFetch<IssueRow>(`/projects/${projectId}/issues/${issueId}`),

  patchIssue: (
    projectId: string,
    issueId: string,
    body: {
      assigneeUserId?: null | string
      resolvedInRelease?: null | string
      status?: 'active' | 'closed' | 'resolved' | 'silenced'
    }
  ) =>
    adminFetch<IssueRow>(`/projects/${projectId}/issues/${issueId}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),

  /** Phase 24 sub-D / Phase 25 sub-F — bulk status / assign. */
  bulkPatchIssues: (
    projectId: string,
    body:
      | { action: 'close' | 'reopen' | 'resolve' | 'silence'; issueIds: string[] }
      | { action: 'assign'; assigneeUserId: null | string; issueIds: string[] }
  ) =>
    adminFetch<{ updated: number }>(`/projects/${projectId}/issues:bulk`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  /** Phase 25 sub-E — unified activity stream (comments + status changes). */
  listIssueActivity: (projectId: string, issueId: string) =>
    adminFetch<ActivityEntry[]>(`/projects/${projectId}/issues/${issueId}/activity`),

  /** Phase 25 sub-E — post a new comment on an issue. */
  createIssueComment: (projectId: string, issueId: string, body: string) =>
    adminFetch<{ id: string }>(`/projects/${projectId}/issues/${issueId}/comments`, {
      body: JSON.stringify({ body }),
      method: 'POST',
    }),

  /** Phase 25 sub-E — delete a comment (author only, plus admins). */
  deleteIssueComment: (projectId: string, issueId: string, commentId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/comments/${commentId}`, {
      method: 'DELETE',
    }),

  /** Phase 25 sub-B — original source window for one stack frame. */
  frameSource: (projectId: string, eventId: string, params: { cause?: number; frame: number }) => {
    const usp = new URLSearchParams()
    usp.set('frame', String(params.frame))
    if (params.cause !== undefined) usp.set('cause', String(params.cause))
    return adminFetch<FrameSource>(
      `/projects/${projectId}/events/${eventId}/source?${usp.toString()}`
    )
  },

  listEvents: (
    projectId: string,
    issueId: string,
    params: { limit?: number; symbolicated?: boolean } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.symbolicated !== undefined) usp.set('symbolicated', String(params.symbolicated))
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<EventRow[]>(`/projects/${projectId}/issues/${issueId}/events${qs}`)
  },

  listIssues: (
    projectId: string,
    params: {
      env?: string
      errorType?: string
      lastSeenAfter?: string
      limit?: number
      release?: string
      status?: string
    } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.status) usp.set('status', params.status)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.env) usp.set('env', params.env)
    if (params.release) usp.set('release', params.release)
    if (params.errorType) usp.set('errorType', params.errorType)
    if (params.lastSeenAfter) usp.set('lastSeenAfter', params.lastSeenAfter)
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<IssueRow[]>(`/projects/${projectId}/issues${qs}`)
  },

  listProjects: () => adminFetch<ProjectRow[]>('/projects'),

  listReleasesForIssue: (projectId: string, issueId: string) =>
    adminFetch<string[]>(`/projects/${projectId}/issues/${issueId}/releases`),

  /** Phase 23 sub-A — list releases for the project, enriched with
   *  event / sourcemap / dSYM / mapping counts. */
  listReleases: (projectId: string, params: { limit?: number } = {}) => {
    const usp = new URLSearchParams()
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<ReleaseListRow[]>(`/projects/${projectId}/releases${qs}`)
  },

  /** Phase 22 sub-F — unified artifact summary for one release. */
  releaseArtifacts: (projectId: string, release: string) =>
    adminFetch<ReleaseArtifacts>(
      `/projects/${projectId}/releases/${encodeURIComponent(release)}/artifacts`
    ),

  /** Phase 23 sub-E — diff issues between two releases. */
  compareReleases: (projectId: string, base: string, target: string) =>
    adminFetch<ReleaseCompare>(
      `/projects/${projectId}/releases/${encodeURIComponent(base)}/compare/${encodeURIComponent(target)}`
    ),

  /** Phase 28 sub-A — Cmd+K cross-entity search. */
  search: (q: string, types?: string) => {
    const usp = new URLSearchParams()
    usp.set('q', q)
    if (types) usp.set('types', types)
    return adminFetch<SearchHit[]>(`/search?${usp.toString()}`)
  },

  /** Phase 26 sub-C — session health aggregates. */
  health: (
    projectId: string,
    params: {
      bucket?: '1d' | '1h' | '5m'
      environment?: string
      from?: string
      release?: string
      to?: string
    } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.from) usp.set('from', params.from)
    if (params.to) usp.set('to', params.to)
    if (params.bucket) usp.set('bucket', params.bucket)
    if (params.release) usp.set('release', params.release)
    if (params.environment) usp.set('environment', params.environment)
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<HealthResponse>(`/projects/${projectId}/health${qs}`)
  },
}

export type HealthResponse = {
  bucket: string
  buckets: HealthBucket[]
  from: string
  summary: HealthSummary
  to: string
}

export type HealthSummary = {
  crashedSessions: number
  crashedUsers: number
  crashFreeSessionRate: null | number
  crashFreeUserRate: null | number
  erroredSessions: number
  totalSessions: number
  totalUsers: number
}

export type HealthBucket = {
  at: string
  crashed: number
  errored: number
  total: number
}

export type ReleaseCompareRow = {
  bucket: 'added' | 'fixed' | 'persisting'
  errorType: string
  eventCount: number
  id: string
  lastSeen: string
  messageSample: string
  status: IssueStatus
}

export type ReleaseCompare = {
  added: ReleaseCompareRow[]
  base: string
  fixed: ReleaseCompareRow[]
  persisting: ReleaseCompareRow[]
  target: string
}

// Phase 28 sub-A — Cmd+K palette result.
export type SearchHit = {
  id: string
  label: string
  sublabel: null | string
  type: 'issue' | 'member' | 'org' | 'project' | 'team'
  url: string
}

// Phase 25 sub-B — frame source preview window.
export type FrameSource = {
  after: string[]
  at: string
  before: string[]
  column: number
  file: string
  line: number
}

// Phase 25 sub-E — issue activity stream entries.
export type ActivityEntry =
  | { at: string; kind: 'regressed'; release: null | string }
  | { at: string; kind: 'resolved'; release: null | string }
  | {
      at: string
      authorEmail: null | string
      authorId: null | string
      body: string
      id: string
      kind: 'comment'
    }

// Phase 27 sub-A/C — alert rule shapes.
export type AlertTriggerKind = 'crash_free_drop' | 'event_count' | 'new_issue' | 'regression'

export type AlertChannel =
  | { secret: string; type: 'webhook'; url: string }
  | { to: string[]; type: 'email' }

export type AlertFilter = {
  environment?: string
  errorTypeRegex?: string
  release?: string
}

export type AlertTriggerConfig = {
  count?: number
  threshold?: number
  windowMinutes?: number
}

export type AlertRule = {
  channels: AlertChannel[]
  createdAt: string
  createdBy: null | string
  enabled: boolean
  filterConfig: AlertFilter
  id: string
  lastFiredAt: null | string
  /** Phase 27 sub-F: explicit silence (open-ended). */
  muted: boolean
  name: string
  orgId: string
  projectId: null | string
  /** Phase 27 sub-F: temporary silence (RFC 3339 timestamp). */
  snoozedUntil: null | string
  throttleMinutes: number
  triggerConfig: AlertTriggerConfig
  triggerKind: AlertTriggerKind
  updatedAt: string
}

export type AlertRuleInput = {
  channels?: AlertChannel[]
  enabled?: boolean
  filterConfig?: AlertFilter
  muted?: boolean
  name?: string
  projectId?: null | string
  snoozedUntil?: null | string
  throttleMinutes?: number
  triggerConfig?: AlertTriggerConfig
  triggerKind?: AlertTriggerKind
}

// Phase 29 sub-B — webhook delivery attempt row for the rule expand.
export type AlertRuleDelivery = {
  attempt: number
  createdAt: string
  deliveredAt: null | string
  id: string
  lastError: null | string
  lastStatus: null | number
  nextAttemptAt: string
  status: 'delivered' | 'failed' | 'pending'
}

// Phase 24 sub-C — saved views.
export type SavedViewScope = 'org' | 'personal' | 'team'

export type SavedView = {
  createdAt: string
  createdBy: null | string
  createdByEmail: null | string
  id: string
  name: string
  payload: SavedViewPayload
  scope: SavedViewScope
  target: string
  teamId: null | string
  teamSlug: null | string
  updatedAt: string
  userId: null | string
}

/** Free-form on the wire; the dashboard picks specific keys per target. */
export type SavedViewPayload = {
  columns?: Record<string, boolean>
  query?: string
  status?: string
}

export type ReleaseListRow = {
  createdAt: string
  deployAt: null | string
  dsymCount: number
  eventCount: number
  firstSeen: null | string
  id: string
  lastSeen: null | string
  mappingCount: number
  name: string
  sourcemapCount: number
}

export type ReleaseArtifacts = {
  dsyms: ReleaseDsym[]
  mappings: ReleaseMapping[]
  release: string
  sourcemaps: ReleaseSourcemap[]
}

export type ReleaseDsym = {
  arch: string
  debugId: string
  id: string
  objectName: null | string
  sizeBytes: number
  uploadedAt: string
  uploadedByEmail: null | string
}

export type ReleaseMapping = {
  debugId: null | string
  id: string
  sizeBytes: number
  uploadedAt: string
  uploadedByEmail: null | string
}

export type ReleaseSourcemap = {
  contentHash: string
  createdAt: string
  id: string
  kind: string
  name: string
}

export type ProjectRow = {
  createdAt: string
  id: string
  name: string
  orgId: string
  orgSlug: string
}

export type AuthUser = { email: string; id: string }

/** Phase 13 sub-B/E: user-based auth (DB session cookie). */
export const userAuthApi = {
  forgotPassword: () => Promise.reject<never>({ body: { error: 'notImplemented' }, status: 501 }),

  login: (email: string, password: string) =>
    authFetch<{ ok: true; user: AuthUser }>('/login', {
      body: JSON.stringify({ email, password }),
      method: 'POST',
    }),

  logout: () => authFetch<{ ok: true }>('/logout', { method: 'POST' }),

  me: () => authFetch<{ user: AuthUser }>('/me'),

  register: (email: string, password: string) =>
    authFetch<{ ok: true }>('/register', {
      body: JSON.stringify({ email, password }),
      method: 'POST',
    }),

  verify: (token: string) => authFetch<{ ok: true }>(`/verify?token=${encodeURIComponent(token)}`),
}

/** Stable dev project id, mirrors `seed::DEV_PROJECT_ID` on the server. */
export const DEV_PROJECT_ID = '019508a0-0000-7000-8000-000000000000'

export type OrgRole = 'admin' | 'member' | 'owner' | 'viewer'

export type OrgRow = {
  createdAt: string
  id: string
  name: string
  ownerId: string
  role: OrgRole
  slug: string
}

export type MemberRow = {
  createdAt: string
  email: string
  role: OrgRole
  userId: string
}

export type InviteRow = {
  createdAt: string
  email: string
  expiresAt: string
  role: OrgRole
  teamSlug: null | string
  token: string
  usedAt: null | string
}

/** Phase 13 sub-C/F/G: orgs / memberships / invites (cookie session). */
export const orgsApi = {
  acceptInvite: (token: string) =>
    orgsFetch<{ ok: true; orgSlug: string }>(`/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    }),

  create: (slug: string, name: string) =>
    orgsFetch<{ id: string; name: string; role: OrgRole; slug: string }>('/orgs', {
      body: JSON.stringify({ name, slug }),
      method: 'POST',
    }),

  createInvite: (slug: string, email: string, role: OrgRole, teamSlug?: null | string) =>
    orgsFetch<{ token: string }>(`/orgs/${slug}/invites`, {
      body: JSON.stringify({
        email,
        role,
        ...(teamSlug ? { teamSlug } : {}),
      }),
      method: 'POST',
    }),

  deleteInvite: (slug: string, token: string) =>
    orgsFetch<{ ok: true }>(`/orgs/${slug}/invites/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }),

  deleteMember: (slug: string, userId: string) =>
    orgsFetch<{ ok: true }>(`/orgs/${slug}/members/${userId}`, { method: 'DELETE' }),

  detail: (slug: string) => orgsFetch<OrgRow>(`/orgs/${slug}`),

  listInvites: (slug: string) => orgsFetch<InviteRow[]>(`/orgs/${slug}/invites`),

  listMembers: (slug: string) => orgsFetch<MemberRow[]>(`/orgs/${slug}/members`),

  listMine: () => orgsFetch<OrgRow[]>('/orgs'),

  patchMember: (slug: string, userId: string, role: OrgRole) =>
    orgsFetch<{ ok: true }>(`/orgs/${slug}/members/${userId}`, {
      body: JSON.stringify({ role }),
      method: 'PATCH',
    }),

  patchOrg: (slug: string, body: { name?: string }) =>
    orgsFetch<{ ok: true }>(`/orgs/${slug}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),

  usage: (slug: string) => orgsFetch<UsageRow>(`/orgs/${slug}/usage`),

  // Phase 27 sub-A/C — alert rules.
  listAlertRules: (orgSlug: string) => orgsFetch<AlertRule[]>(`/orgs/${orgSlug}/alert-rules`),
  createAlertRule: (orgSlug: string, body: AlertRuleInput) =>
    orgsFetch<{ id: string }>(`/orgs/${orgSlug}/alert-rules`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),
  patchAlertRule: (orgSlug: string, id: string, body: Partial<AlertRuleInput>) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/alert-rules/${id}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),
  deleteAlertRule: (orgSlug: string, id: string) =>
    orgsFetch<null>(`/orgs/${orgSlug}/alert-rules/${id}`, { method: 'DELETE' }),

  // Phase 29 sub-B — webhook delivery history per rule (last 10).
  listAlertRuleDeliveries: (orgSlug: string, ruleId: string) =>
    orgsFetch<AlertRuleDelivery[]>(`/orgs/${orgSlug}/alert-rules/${ruleId}/deliveries`),

  // Phase 24 sub-C — saved views.
  listViews: (orgSlug: string, target = 'issues') =>
    orgsFetch<SavedView[]>(`/orgs/${orgSlug}/views?target=${encodeURIComponent(target)}`),

  createView: (
    orgSlug: string,
    body: {
      name: string
      payload: SavedViewPayload
      scope: SavedViewScope
      target?: string
      teamSlug?: string
    }
  ) =>
    orgsFetch<{ id: string }>(`/orgs/${orgSlug}/views`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  deleteView: (orgSlug: string, id: string) =>
    orgsFetch<null>(`/orgs/${orgSlug}/views/${id}`, { method: 'DELETE' }),
}

export type TeamRole = 'lead' | 'member' | 'viewer'

export type TeamRow = {
  createdAt: string
  description: null | string
  id: string
  name: string
  orgId: string
  slug: string
}

export type TeamMemberRow = {
  createdAt: string
  email: string
  role: TeamRole
  userId: string
}

export type TeamProjectRow = {
  createdAt: string
  id: string
  name: string
}

/** Phase 18 sub-B/C/D: teams + project↔team binding + ownership transfer + audit. */
export const teamsApi = {
  addMember: (orgSlug: string, teamSlug: string, userId: string, role: TeamRole) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/teams/${teamSlug}/members`, {
      body: JSON.stringify({ role, userId }),
      method: 'POST',
    }),

  bindProject: (projectId: string, teamSlug: string) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}/teams/${teamSlug}`, { method: 'POST' }),

  create: (orgSlug: string, body: { description?: string; name: string; slug: string }) =>
    orgsFetch<TeamRow>(`/orgs/${orgSlug}/teams`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  delete: (orgSlug: string, teamSlug: string) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/teams/${teamSlug}`, { method: 'DELETE' }),

  detail: (orgSlug: string, teamSlug: string) =>
    orgsFetch<TeamRow>(`/orgs/${orgSlug}/teams/${teamSlug}`),

  list: (orgSlug: string) => orgsFetch<TeamRow[]>(`/orgs/${orgSlug}/teams`),

  listMembers: (orgSlug: string, teamSlug: string) =>
    orgsFetch<TeamMemberRow[]>(`/orgs/${orgSlug}/teams/${teamSlug}/members`),

  listProjectTeams: (projectId: string) => adminFetch<TeamRow[]>(`/projects/${projectId}/teams`),

  listProjects: (orgSlug: string, teamSlug: string) =>
    orgsFetch<TeamProjectRow[]>(`/orgs/${orgSlug}/teams/${teamSlug}/projects`),

  patch: (orgSlug: string, teamSlug: string, body: { description?: string; name?: string }) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/teams/${teamSlug}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),

  patchMember: (orgSlug: string, teamSlug: string, userId: string, role: TeamRole) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/teams/${teamSlug}/members/${userId}`, {
      body: JSON.stringify({ role }),
      method: 'PATCH',
    }),

  removeMember: (orgSlug: string, teamSlug: string, userId: string) =>
    orgsFetch<{ ok: true }>(`/orgs/${orgSlug}/teams/${teamSlug}/members/${userId}`, {
      method: 'DELETE',
    }),

  unbindProject: (projectId: string, teamSlug: string) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}/teams/${teamSlug}`, { method: 'DELETE' }),
}

export type AuditRow = {
  action: string
  actorEmail: null | string
  actorUserId: null | string
  createdAt: string
  id: string
  payload: unknown
  targetId: null | string
  targetType: string
}

export type AuditActionInfo = { code: string; label: string }

export type UserActivityRow = {
  action: string
  createdAt: string
  id: string
  orgId: null | string
  orgName: null | string
  orgSlug: null | string
  payload: unknown
  targetId: null | string
  targetType: string
}

export const userActivityApi = {
  list: (params?: { before?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.before) qs.set('before', params.before)
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return orgsFetch<UserActivityRow[]>(`/users/me/activity${suffix}`)
  },
}

export const auditApi = {
  /** Phase 20 sub-A: catalog of (code, label) for the action filter
   *  dropdown. Single source of truth lives in
   *  `server/src/audit.rs::all_labels`. */
  actions: () => orgsFetch<AuditActionInfo[]>('/audit/actions'),

  list: (
    orgSlug: string,
    params?: {
      action?: string
      actorUserId?: string
      before?: string
      limit?: number
      targetType?: string
    }
  ) => {
    const qs = new URLSearchParams()
    if (params?.action) qs.set('action', params.action)
    if (params?.actorUserId) qs.set('actorUserId', params.actorUserId)
    if (params?.before) qs.set('before', params.before)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.targetType) qs.set('targetType', params.targetType)
    const suffix = qs.toString() ? `?${qs}` : ''
    return orgsFetch<AuditRow[]>(`/orgs/${orgSlug}/audit${suffix}`)
  },
}

export const transfersApi = {
  accept: (token: string) =>
    orgsFetch<{ ok: true }>(`/orgs/transfers/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    }),
  create: (orgSlug: string, toUserId: string) =>
    orgsFetch<{ expiresAt: string; id: string }>(`/orgs/${orgSlug}/transfer`, {
      body: JSON.stringify({ toUserId }),
      method: 'POST',
    }),
}

export type UsageRow = {
  droppedCount: number
  eventCount: number
  eventLimitMonthly: number
  percentUsed: number
  periodYyyymm: string
  plan: 'enterprise' | 'free' | 'pro'
  resetAt: string
  retentionDays: number
}

export type ProjectCreated = {
  createdAt: string
  id: string
  name: string
  orgId: string
  orgSlug: string
}

/** Phase 14 sub-A: project mutations (list lives on adminApi). */
export const projectsApi = {
  create: (orgSlug: string, name: string) =>
    adminFetch<ProjectCreated>(`/orgs/${orgSlug}/projects`, {
      body: JSON.stringify({ name }),
      method: 'POST',
    }),
}

export type TokenRow = {
  createdAt: string
  id: string
  kind: 'admin' | 'public'
  label: null | string
  last4: null | string
  revokedAt: null | string
}

export type TokenCreated = {
  createdAt: string
  id: string
  kind: 'admin' | 'public'
  label: null | string
  /** Returned exactly once on create — store it now. */
  token: string
}

/** Phase 14 sub-A: ingest token CRUD. */
export const tokensApi = {
  create: (projectId: string, body: { kind?: 'admin' | 'public'; label?: string }) =>
    adminFetch<TokenCreated>(`/projects/${projectId}/tokens`, {
      body: JSON.stringify({ kind: body.kind ?? 'public', label: body.label ?? null }),
      method: 'POST',
    }),

  list: (projectId: string) => adminFetch<TokenRow[]>(`/projects/${projectId}/tokens`),

  revoke: (projectId: string, tokenId: string) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}/tokens/${tokenId}`, { method: 'DELETE' }),
}

export type RecipientRow = {
  createdAt: string
  email: string
  id: string
  onNewIssue: boolean
  onRegression: boolean
}

/** Phase 13 sub-G (回填 Phase 9): notification_recipients CRUD. */
export const recipientsApi = {
  create: (
    projectId: string,
    body: { email: string; onNewIssue?: boolean; onRegression?: boolean }
  ) =>
    adminFetch<{ email: string; id: string; onNewIssue: boolean; onRegression: boolean }>(
      `/projects/${projectId}/recipients`,
      {
        body: JSON.stringify({
          email: body.email,
          onNewIssue: body.onNewIssue ?? true,
          onRegression: body.onRegression ?? false,
        }),
        method: 'POST',
      }
    ),

  delete: (projectId: string, recipientId: string) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}/recipients/${recipientId}`, {
      method: 'DELETE',
    }),

  list: (projectId: string) => adminFetch<RecipientRow[]>(`/projects/${projectId}/recipients`),

  patch: (
    projectId: string,
    recipientId: string,
    body: { onNewIssue?: boolean; onRegression?: boolean }
  ) =>
    adminFetch<{ ok: true }>(`/projects/${projectId}/recipients/${recipientId}`, {
      body: JSON.stringify({
        onNewIssue: body.onNewIssue,
        onRegression: body.onRegression,
      }),
      method: 'PATCH',
    }),
}
