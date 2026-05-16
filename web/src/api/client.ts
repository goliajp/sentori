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

/** Phase 47.01 — slim row for the related-issues panel. */
export type RelatedIssue = {
  errorType: string
  eventCount: number
  id: string
  lastSeen: string
  messageSample: string
  status: IssueStatus
}

// Phase 36 sub-A: trace list row, mirrors server/src/api/traces.rs#TraceRow.
export type TraceStatus = 'cancelled' | 'error' | 'ok'
export type TraceRow = {
  durationMs: number
  firstSeen: string
  lastSeen: string
  rootName: null | string
  rootOp: null | string
  spanCount: number
  status: TraceStatus
  traceId: string
}

// Phase 36 sub-B: trace detail. Server returns `{ trace, spans[] }`;
// the client builds the parent_span_id tree.
export type SpanRow = {
  data: null | Record<string, unknown>
  durationMs: number
  id: string
  name: string
  op: string
  parentSpanId: null | string
  startedAt: string
  status: TraceStatus
  tags: Record<string, string>
  traceId: string
}

export type TraceEventRef = {
  errorType: string
  id: string
  issueId: null | string
  spanId: null | string
}

export type TraceDetail = {
  events: TraceEventRef[]
  spans: SpanRow[]
  trace: TraceRow
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
  /** Phase 36 sub-C: set when this event was captured inside an active
   *  span. Dashboard renders an "In trace →" pill that jumps to the
   *  trace detail view. */
  spanId?: null | string
  traceId?: null | string
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
    /** v0.8.0-c — `wifi` / `4g` / `3g` / `2g` / `slow-2g` / `offline`
     *  / `unknown`. Free-form string on the wire to allow forward-
     *  compat values (e.g. `5g`) without a schema bump. */
    networkType?: string
    os: string
    osVersion: string
  }
  environment: string
  error: SentoriError
  fingerprint: string[]
  /** v0.8.0-d — server-set from GeoIP lookup on client IP. Absent
   *  when the operator hasn't configured a db or IP isn't resolvable. */
  geo?: {
    city?: string
    country: string
    region?: string
  }
  /** v0.9.0 #10 — OTA bundle (EAS Update / CodePush) currently loaded. */
  bundle?: {
    deployedAt?: string
    id: string
    source?: string
  }
  id: string
  kind: 'anr' | 'error'
  platform: 'android' | 'ios' | 'javascript'
  release: string
  spanId: null | string
  /** Server-set at ingest. `releaseHasMap: true` + still-raw frames =
   *  the uploaded source map doesn't match this build / frames fall
   *  outside it. Absent on old events. */
  symbolication?: { releaseHasMap: boolean }
  tags: Record<string, string>
  /** v0.9.0 #13 — feature-flag state at capture time. Distinct from
   *  tags: dashboard treats these as experiment dimensions. Absent
   *  when no flags were set. */
  flags?: Record<string, string>
  timestamp: string
  traceId: null | string
  user: null | { anonymous?: boolean; id?: string }
  /** Phase 42 sub-C.09: SDK-uploaded attachments (screenshots, view
   *  trees, state snapshots). Each `ref` is server-issued; the
   *  dashboard fetches the blob via
   *  `GET /admin/api/events/<id>/attachments/<ref>`. Empty / absent
   *  on every event today; sub-D / sub-E / sub-F wire the SDK side. */
  attachments?: Attachment[]
}

export type Attachment = {
  ref: string
  kind: 'logTail' | 'replay' | 'screenshot' | 'sessionTrail' | 'stateSnapshot' | 'viewTree'
  mediaType?: string
  sizeBytes?: number
  source?: 'android' | 'ios' | 'js'
}

export type SentoriError = {
  cause: null | SentoriError
  message: string
  stack: Frame[]
  type: string
  /** Phase 44 sub-E: SDK-asserted pointer to a related native crash
   *  issue. When set, the dashboard appends a final "caused by →
   *  native crash" card to the cause chain that links to the
   *  native issue's detail page. Server pass-through only; the
   *  dashboard validates the link itself. */
  nativeError?: null | NativeErrorRef
}

export type NativeErrorRef = {
  issueId: string
  type: string
  message: string
}

export type Frame = {
  absolutePath?: string
  column?: number
  /** The source line at `line` itself (server-set on symbolicated JS
   *  frames; some native SDKs fill it too). Between pre/post context. */
  contextLine?: string
  file: string
  function?: string
  inApp: boolean
  line: number
  postContext?: string[]
  preContext?: string[]
}

export type Breadcrumb = {
  data: Record<string, unknown>
  timestamp: string
  type: 'custom' | 'log' | 'nav' | 'net' | 'user'
}

export type IntegrationRow = {
  id: string
  orgId: string
  orgSlug: string
  kind: 'linear' | 'slack'
  display: Record<string, null | string | undefined>
  createdAt: string
}

export const adminApi = {
  /** Phase 43 sub-A.03: list active integrations across the caller's orgs. */
  listIntegrations: () => adminFetch<IntegrationRow[]>('/integrations'),
  /** Build the OAuth connect URL. The browser must navigate there
   *  (not fetch) since OAuth needs a top-level redirect. */
  integrationConnectUrl: (kind: string, orgSlug: string): string =>
    `/admin/api/integrations/${kind}/connect?orgSlug=${encodeURIComponent(orgSlug)}`,
  /** Soft-revoke (sets `revoked_at`). */
  revokeIntegration: (kind: string, orgSlug: string) =>
    adminFetch<null>(`/integrations/${kind}?orgSlug=${encodeURIComponent(orgSlug)}`, {
      method: 'DELETE',
    }),
  /** Phase 43 sub-E.02: manual config (Slack). Body is
   *  `{ orgSlug, ...adapter-specific fields }`. */
  configureIntegration: (kind: string, body: Record<string, unknown> & { orgSlug: string }) =>
    adminFetch<null>(`/integrations/${kind}/configure`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  issueDetail: (projectId: string, issueId: string) =>
    adminFetch<IssueRow>(`/projects/${projectId}/issues/${issueId}`),

  /** Phase 42 sub-A.11: update project settings.
   *  `sourceRepoUrl: null` clears the value; omit the key to leave
   *  it untouched. */
  patchProject: (projectId: string, body: { sourceRepoUrl?: null | string }) =>
    adminFetch<null>(`/projects/${projectId}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),

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

  /** Phase 44 sub-C: merge `sourceIssueId`'s events into
   *  `targetIssueId` and delete the source. */
  mergeIssue: (projectId: string, sourceIssueId: string, targetIssueId: string) =>
    adminFetch<{ eventsMoved: number; targetIssueId: string }>(
      `/projects/${projectId}/issues/${sourceIssueId}/merge`,
      {
        body: JSON.stringify({ targetIssueId }),
        method: 'POST',
      }
    ),

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

  /** v0.8.2 — end-user-submitted bug reports for this issue. */
  listUserReportsForIssue: (projectId: string, issueId: string) =>
    adminFetch<UserReport[]>(`/projects/${projectId}/issues/${issueId}/user-reports`),

  /** v0.8.2 — project-wide inbox (reports without an event_id + recent
   *  ones with an event_id mixed in). */
  listUserReportsForProject: (projectId: string) =>
    adminFetch<UserReport[]>(`/projects/${projectId}/user-reports`),

  /** v0.8.3 — distinct metric names + 24h counts. Drives the Metrics
   *  page's left rail. */
  listMetricNames: (projectId: string) =>
    adminFetch<MetricName[]>(`/projects/${projectId}/metric-names`),

  /** v0.9.0 #6 — moments aggregation (last 7d) + samples per moment. */
  listMoments: (projectId: string) => adminFetch<MomentRow[]>(`/projects/${projectId}/moments`),

  listMomentSamples: (projectId: string, name: string) =>
    adminFetch<MomentSample[]>(`/projects/${projectId}/moments/${encodeURIComponent(name)}`),

  /** v0.9.4 #1 — mobile vitals report + release list. */
  vitalsReport: (projectId: string, release?: string) => {
    const q = release ? `?release=${encodeURIComponent(release)}` : ''
    return adminFetch<VitalsReport>(`/projects/${projectId}/vitals${q}`)
  },
  listVitalsReleases: (projectId: string) =>
    adminFetch<VitalsRelease[]>(`/projects/${projectId}/vitals/releases`),

  /** v0.9.3 +S3 — culprit commits per issue. */
  listCulprits: (projectId: string, issueId: string) =>
    adminFetch<CulpritRow[]>(`/projects/${projectId}/issues/${issueId}/culprits`),

  attachCulprit: (projectId: string, issueId: string, commitSha: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/culprits`, {
      body: JSON.stringify({ commitSha }),
      method: 'POST',
    }),

  detachCulprit: (projectId: string, issueId: string, culpritId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/culprits/${culpritId}`, {
      method: 'DELETE',
    }),

  /** v1.1 +S3 升级 — on-demand auto-detect best culprit candidate. */
  autoDetectCulprit: (projectId: string, issueId: string) =>
    adminFetch<{ commitSha: string; confidence: number; score: number }>(
      `/projects/${projectId}/issues/${issueId}/culprits:auto`,
      { method: 'POST' }
    ),

  /** v1.1 +S3 升级 — generate a Revert PR draft via GitHub API. */
  generateRevertPr: (projectId: string, issueId: string, culpritId: string) =>
    adminFetch<{ prUrl: string }>(
      `/projects/${projectId}/issues/${issueId}/culprits/${culpritId}/revert-pr`,
      { method: 'POST' }
    ),

  /** v0.9.2 +S6 — privacy score + findings. */
  privacyScore: (projectId: string, release?: string) => {
    const q = release ? `?release=${encodeURIComponent(release)}` : ''
    return adminFetch<PrivacyScore>(`/projects/${projectId}/privacy/score${q}`)
  },

  privacyFindings: (projectId: string, params?: { limit?: number; release?: string }) => {
    const usp = new URLSearchParams()
    if (params?.release) usp.set('release', params.release)
    if (params?.limit !== undefined) usp.set('limit', String(params.limit))
    const qs = usp.toString()
    return adminFetch<PrivacyFinding[]>(
      `/projects/${projectId}/privacy/findings${qs ? '?' + qs : ''}`
    )
  },

  /** v0.8.4 — cert-monitor watchlist. */
  listCertWatchDomains: (projectId: string) =>
    adminFetch<CertWatchDomain[]>(`/projects/${projectId}/cert-monitor/domains`),

  addCertWatchDomain: (projectId: string, domain: string) =>
    adminFetch<{ id: string; domain: string }>(`/projects/${projectId}/cert-monitor/domains`, {
      body: JSON.stringify({ domain }),
      method: 'POST',
    }),

  deleteCertWatchDomain: (projectId: string, watchId: string) =>
    adminFetch<null>(`/projects/${projectId}/cert-monitor/domains/${watchId}`, {
      method: 'DELETE',
    }),

  /** v0.8.4 — recent CT observations across the project. */
  listCertObservations: (projectId: string) =>
    adminFetch<CertObservation[]>(`/projects/${projectId}/cert-monitor/observations`),

  /** v0.8.3 — recent points for a metric (defaults to last 24h). */
  listMetrics: (projectId: string, params: { limit?: number; name?: string; since?: string }) => {
    const usp = new URLSearchParams()
    if (params.name) usp.set('name', params.name)
    if (params.since) usp.set('since', params.since)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    const qs = usp.toString()
    return adminFetch<MetricPoint[]>(`/projects/${projectId}/metrics${qs ? '?' + qs : ''}`)
  },

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
  frameSource: (
    projectId: string,
    eventId: string,
    params: { cause?: number; frame: number; lines?: number }
  ) => {
    const usp = new URLSearchParams()
    usp.set('frame', String(params.frame))
    if (params.cause !== undefined) usp.set('cause', String(params.cause))
    if (params.lines !== undefined) usp.set('lines', String(params.lines))
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

  /** Phase 48 sub-A.2 — list every attachment the server has for an
   *  event, regardless of payload echo. Used by the dashboard's
   *  AttachmentGallery so a broken client echo never hides a screenshot. */
  listEventAttachments: (projectId: string, eventId: string) =>
    adminFetch<Attachment[]>(
      `/projects/${projectId}/events/${encodeURIComponent(eventId)}/attachments`
    ),

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

  /**
   * Phase 33 sub-B: keyset-paginated variant of `listIssues`. Pass
   * `cursor` from the previous page's `nextCursor` to keep scrolling.
   * Returns `nextCursor: null` once the server stops emitting the
   * `X-Next-Cursor` header (i.e. the last page was shorter than
   * `limit`).
   */
  listIssuesPage: async (
    projectId: string,
    params: {
      cursor?: null | string
      env?: string
      errorType?: string
      lastSeenAfter?: string
      limit?: number
      release?: string
      /** Phase 44 sub-D: free-text search across `error_type +
       *  message_sample` on `issues`. Multiple words → AND. */
      search?: string
      status?: string
    } = {}
  ): Promise<{ issues: IssueRow[]; nextCursor: null | string }> => {
    const usp = new URLSearchParams()
    if (params.status) usp.set('status', params.status)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.env) usp.set('env', params.env)
    if (params.release) usp.set('release', params.release)
    if (params.errorType) usp.set('errorType', params.errorType)
    if (params.lastSeenAfter) usp.set('lastSeenAfter', params.lastSeenAfter)
    if (params.search) usp.set('search', params.search)
    if (params.cursor) usp.set('cursor', params.cursor)
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    const resp = await fetch(`${ADMIN_BASE}/projects/${projectId}/issues${qs}`, {
      credentials: 'include',
    })
    if (!resp.ok) {
      let body: unknown
      try {
        body = await resp.json()
      } catch {
        body = await resp.text()
      }
      throw { body, status: resp.status } as AdminApiError
    }
    const issues = (await resp.json()) as IssueRow[]
    return { issues, nextCursor: resp.headers.get('X-Next-Cursor') }
  },

  /** Phase 36 sub-A: keyset-paginated trace list. Same X-Next-Cursor
   *  contract as listIssuesPage. */
  listTracesPage: async (
    projectId: string,
    params: {
      cursor?: null | string
      durationMs?: number
      /** `true` → hide orphan traces (no root span — the typical
       *  fast-refresh artifact). `false` → show only orphans. Omit
       *  to include both. Dashboard default is `true`. */
      hasRoot?: boolean
      limit?: number
      op?: string
      status?: TraceStatus
    } = {}
  ): Promise<{ nextCursor: null | string; traces: TraceRow[] }> => {
    const usp = new URLSearchParams()
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.op) usp.set('op', params.op)
    if (params.status) usp.set('status', params.status)
    if (params.durationMs !== undefined) usp.set('durationMs', String(params.durationMs))
    if (params.hasRoot !== undefined) usp.set('hasRoot', String(params.hasRoot))
    if (params.cursor) usp.set('cursor', params.cursor)
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    const resp = await fetch(`${ADMIN_BASE}/projects/${projectId}/traces${qs}`, {
      credentials: 'include',
    })
    if (!resp.ok) {
      let body: unknown
      try {
        body = await resp.json()
      } catch {
        body = await resp.text()
      }
      throw { body, status: resp.status } as AdminApiError
    }
    const traces = (await resp.json()) as TraceRow[]
    return { nextCursor: resp.headers.get('X-Next-Cursor'), traces }
  },

  /** Phase 36 sub-B: one trace + all its spans, server returns the
   *  set sorted by started_at asc (the client builds the
   *  parent_span_id tree). */
  getTraceDetail: (projectId: string, traceId: string) =>
    adminFetch<TraceDetail>(`/projects/${projectId}/traces/${traceId}`),

  listProjects: () => adminFetch<ProjectRow[]>('/projects'),

  listReleasesForIssue: (projectId: string, issueId: string) =>
    adminFetch<string[]>(`/projects/${projectId}/issues/${issueId}/releases`),

  /** Phase 47.01 — sibling issues likely to share root cause. */
  listRelatedIssues: (projectId: string, issueId: string) =>
    adminFetch<RelatedIssue[]>(`/projects/${projectId}/issues/${issueId}/related`),

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

// v0.8.4 — CT monitor shapes.
export type CertWatchDomain = {
  createdAt: string
  domain: string
  id: string
}

export type CertObservation = {
  certId: number
  commonName: null | string
  domain: string
  firstSeen: string
  id: string
  issuerName: string
  nameValue: null | string
  notAfter: string
  notBefore: string
}

// v0.9.4 #1 — mobile vitals shapes.
export type VitalsReport = {
  coldStart: { p50Ms: number; p95Ms: number; samples: number }
  perRoute: {
    navigations: number
    route: string
    totalFrozenFrames: number
    totalSlowFrames: number
    ttfdP50Ms: number
    ttfdP95Ms: number
    ttfdSamples: number
    ttidP50Ms: number
    ttidP95Ms: number
  }[]
  release: string
}

export type VitalsRelease = {
  eventCount: number
  lastSeen: string
  release: string
}

// v0.9.3 +S3 — culprit commit shapes.
export type CulpritRow = {
  author: null | string
  commitSha: string
  committedAt: null | string
  confidence: number
  createdAt: string
  htmlUrl: null | string
  id: string
  message: null | string
  source: 'auto' | 'manual'
}

// v0.9.2 +S6 — Privacy Lab shapes.
export type PrivacyScore = {
  leakingEvents: number
  leaksByKind: Record<string, number>
  release: string
  risk: 'high' | 'low' | 'medium'
  score: number
  topFields: { count: number; fieldPath: string; kind: string }[]
  totalEvents: number
}

export type PrivacyFinding = {
  eventId: string
  fieldPath: string
  id: string
  patternKind: string
  release: string
  sample: string
  seenAt: string
}

// v0.9.0 #6 — Moments shapes.
export type MomentRow = {
  abandoned: number
  count: number
  failed: number
  lastSeen: string
  name: string
  p50Ms: number
  p95Ms: number
}

export type MomentSample = {
  abandoned: boolean
  durationMs: number
  id: string
  name: string
  startedAt: string
  status: string
}

// v0.8.3 — custom metric shapes.
export type MetricName = {
  count: number
  lastSeen: string
  name: string
}

export type MetricPoint = {
  id: string
  name: string
  tags: Record<string, unknown>
  ts: string
  value: number
}

// v0.8.2 — end-user-submitted bug reports.
export type UserReport = {
  body: string
  email: null | string
  eventId: null | string
  id: string
  issueId: null | string
  name: null | string
  projectId: string
  receivedAt: string
  title: string
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
  /** Phase 42 sub-A.11: optional repo root URL (e.g.
   *  `https://github.com/goliajp/sentori`). When set, the dashboard
   *  links frame paths to the matching blob on GitHub-compatible
   *  hosts (GitLab, Bitbucket Cloud, Gitea all follow the same
   *  `/blob/<ref>/<file>#L<line>` shape). `null` hides the link. */
  sourceRepoUrl?: null | string
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
