const ADMIN_BASE = '/admin/api'
const AUTH_BASE = '/api/auth'

/** F2 — structured error body the server returns on every non-2xx. */
export type ErrorBodyV2 = {
  code: string
  message: string
  hint?: string
  docUrl?: string
  correlationId: string
  layer: string
  details?: { field: string; message: string }[]
}

export type AdminApiError = {
  /** Parsed error body when the server returned a structured JSON
   *  envelope per F2; raw text otherwise. */
  body: { error: ErrorBodyV2 } | unknown
  /** Correlation id pulled from `X-Sentori-Correlation-Id` response
   *  header. Always present once the server deploys F1. Useful for
   *  support tickets and log grep. */
  correlationId?: string
  status: number
}

/** Type-narrowing helper for the structured envelope. */
export function isStructuredError(
  e: unknown
): e is { body: { error: ErrorBodyV2 }; status: number } {
  if (!e || typeof e !== 'object') return false
  const body = (e as { body?: unknown }).body
  if (!body || typeof body !== 'object') return false
  const err = (body as { error?: unknown }).error
  return !!(err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string')
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
  const correlationId = resp.headers.get('x-sentori-correlation-id') ?? undefined
  if (!resp.ok) {
    let body: unknown
    try {
      body = await resp.json()
    } catch {
      body = await resp.text()
    }
    const err: AdminApiError = { body, correlationId, status: resp.status }
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

export type IssueStatus = 'active' | 'closed' | 'muted' | 'regressed' | 'resolved' | 'silenced'

/** v1.2 W4 — operator-set triage priority. p3 = default / unranked. */
export type IssuePriority = 'p0' | 'p1' | 'p2' | 'p3'

/**
 * v2.1 — re-fingerprint admin tool response shape. Mirrors
 * `server/src/api/admin/refingerprint.rs::RefingerprintResponse`.
 */
export type RefingerprintGroup = {
  fp: string
  count: number
  sample: string
  targetIssueId: null | string
  staysInCurrent: boolean
}
export type RefingerprintResponse = {
  totalEvents: number
  currentFp: string
  groups: RefingerprintGroup[]
  applied: boolean
}

/**
 * v2.2 — `/related-across-releases` response shape. Mirrors
 * `server/src/api/admin/related.rs::RelatedResp`. Caller renders
 * each row as "the same bug also landed in release X, currently
 * <status>" — operator decides if it's truly the same.
 *
 * Name choice — `CrossReleaseRelatedIssue` (not just `RelatedIssue`)
 * because Phase 47.01's `RelatedIssue` type below covers a different
 * relation (Linear / Jira / GitHub integration links). Both panels
 * coexist; the names disambiguate.
 */
export type CrossReleaseRelatedIssue = {
  id: string
  errorType: string
  messageSample: string
  lastRelease: string
  status: string
  eventCount: number
  firstSeen: string
  lastSeen: string
  resolvedAt: null | string
  resolvedInRelease: null | string
}
export type RelatedAcrossReleasesResp = {
  sourceIssueId: string
  errorType: string
  lastRelease: string
  related: CrossReleaseRelatedIssue[]
}

/**
 * v2.2 — `/explore` single query endpoint shape. Mirrors
 * `server/src/api/admin/explore.rs`. Whitelist of `dim × measure ×
 * filter` — see that file for the supported values per version.
 *
 * Same endpoint backs UI module rendering AND LLM agent queries —
 * keep this type narrow + well-named so both consumers can read it.
 */
export type ExploreDim =
  | 'issue'
  | 'release'
  | 'time_bucket'
  // v2.3 — additions per docs/roadmap/post-v2.2-plan.md Phase 2.
  | 'device_os'
  | 'issue_priority'
  | 'severity'
  | 'route'
export type ExploreBucket = 'day' | 'hour' | 'week'
export type ExploreMeasure =
  | 'event_count'
  | 'issue_count'
  | 'resolved_count'
  | 'unique_users'
  | 'first_seen'
  | 'last_seen'
  // v2.3 — additions. `crash_free_rate` is reserved but the server
  // rejects it pending session-schema work (see Phase 1 audit).
  | 'new_issue_count'
  | 'p50_duration'
  | 'p95_duration'
  | 'crash_free_rate'
export type ExploreFilters = {
  receivedAtGte?: string // RFC-3339
  receivedAtLt?: string
  environmentEq?: string
  kindIn?: string[]
  /** Slice rows that touch this release. `dim=issue` → issues with
   *  last_release = X. `dim=release` → that single row. */
  releaseEq?: string
  /** `dim=issue` only — filter by status. */
  statusIn?: string[]
  /** v2.3 — single-issue filter. Most useful with
   *  `dim=time_bucket` to render a per-issue sparkline (the v2.2 W3
   *  stub). Ignored on `dim=issue` where row identity already is
   *  the issue. */
  issueEq?: string
  /** v2.3 — single-user filter. `payload.user.id = X`. Phase 7
   *  find-user lens uses this. */
  userIdEq?: string
  /** v2.3 — single-route filter. `payload.tags.route = X`. Phase 8
   *  find-slow drill key. */
  routeEq?: string
  /** v2.3 — `payload.device.os = X`. */
  osEq?: string
  /** v2.3 — server-side fuzzy match against `error.type`,
   *  `error.message`, `message`. Replaces the v2.2 W3 client-side
   *  search stub. */
  search?: string
}
export type ExploreReq = {
  dim: ExploreDim
  measures: ExploreMeasure[]
  filters?: ExploreFilters
  orderBy?: ExploreMeasure
  orderDir?: 'asc' | 'desc'
  limit?: number
  /** `dim=time_bucket` only — override the auto-picked bucket size. */
  bucket?: ExploreBucket
}
/** One row per dim value, free-shape so the table renderer can
 *  read `row[measureName]` regardless of which measures the
 *  caller asked for. `dim` field name lives alongside measures. */
export type ExploreRow = Record<string, null | number | string>
export type ExploreResp = {
  rows: ExploreRow[]
  totals: Record<string, number>
  meta: {
    dim: string
    measures: ExploreMeasure[]
    rowCount: number
    tookMs: number
    receivedAtGte: string
    receivedAtLt: string
  }
}

export type IssueRow = {
  /**
   * v2.4 — distinct identity fingerprints that ever touched this
   * issue. Privacy-aware counterpart to `eventCount`. List queries
   * always return 0; only issue-detail computes the real number
   * (cold-path subquery in `issues.rs`).
   */
  affectedUsers?: number
  /** Phase 25 sub-F: NULL when nobody owns this issue. */
  assigneeEmail: null | string
  assigneeUserId: null | string
  errorType: string
  eventCount: number
  fingerprint: string
  firstSeen: string
  id: string
  /** v1.2 W4 — operator-typed tags. Always an array (defaults to []). */
  labels: string[]
  lastEnvironment: null | string
  lastRelease: null | string
  lastSeen: string
  messageSample: string
  /** v1.2 W4 — always present; new issues default to 'p3'. */
  priority: IssuePriority
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

export type IntegrationKind = 'github' | 'gitlab' | 'jira' | 'linear' | 'slack'

export type IntegrationRow = {
  id: string
  orgId: string
  orgSlug: string
  kind: IntegrationKind
  display: Record<string, null | string | undefined>
  createdAt: string
}

// v1.4 W23 — cross-org integration sharing / templating.
export type IntegrationTemplateRow = {
  id: string
  kind: IntegrationKind
  name: string
  config: Record<string, unknown>
  ownerUserId: string
  ownerEmail: null | string
  sharedWithOrgId: null | string
  sharedWithOrgSlug: null | string
  createdAt: string
  updatedAt: string
}

export type IntegrationTemplateBody = {
  kind: IntegrationKind
  name: string
  config: Record<string, unknown>
  sharedWithOrgSlug?: null | string
}

/** A single wireframe replay frame, as emitted by the SDK and
 *  returned parsed by the server's replay-frames endpoint. */
export type ReplayFrame = {
  ts: number
  width: number
  height: number
  nodes: ReplayNode[]
}

export type ReplayNode = {
  kind?: 'image' | 'mask' | 'rect' | 'text'
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: string
}

/** F4 — platform-health snapshot from /admin/api/self-test. */
export type SelfTest = {
  dbRtMs: null | number
  overall: 'amber' | 'green' | 'red'
  serverVersion: string
  valkeyRtMs: null | number
}

/** Analytics v1 chunk A — live concurrent-user snapshot per project. */
export type LiveSnapshot = {
  byCountry: BreakdownRow[]
  byOs: BreakdownRow[]
  byRelease: BreakdownRow[]
  byRoute: BreakdownRow[]
  concurrent: number
  windowSeconds: number
}
export type BreakdownRow = { count: number; label: string }

/** v1.1 chunk C — Audience metrics endpoint payload. Buckets are
 *  ordered ascending in time. `granularity` echoes the request so
 *  the dashboard can label the axis without guessing. */
export type AudienceMetrics = {
  buckets: AudienceBucket[]
  granularity: 'day' | 'hour'
  since: string
  totals: AudienceTotals
  until: string
}
export type AudienceBucket = {
  dau: number
  errors: number
  pageviews: number
  /** RFC 3339 timestamp at bucket start. */
  t: string
  trackEvents: number
}
export type AudienceTotals = {
  errors: number
  pageviews: number
  trackEvents: number
  uniqueUsers: number
}

/** v1.1 chunk S2 — Pin anomaly aggregate row. One per serverName in
 *  the window. */
export type PinAnomalyRow = {
  count: number
  installCount: number
  lastSeen: string
  serverName: null | string
}

/** v1.1 chunk S3 — Trust score row in the Posture > Trust tab. */
export type TrustScoreRow = {
  eventCount: number
  installId: string
  kinds: Record<string, number>
  lastSeen: string
  score: number
}

/** v1.1 chunk S4 — one row per project that linked the same
 *  (provider, subject) tuple. Same federated identity across N apps
 *  surfaces as N rows here. */
export type FederationRow = {
  createdAt: string
  installId: null | string
  projectId: string
  projectName: null | string
  userId: null | string
}

/** v1.1 chunk D — top routes from $pageview track events. */
export type TopRouteRow = {
  route: string
  uniqueUsers: number
  views: number
}

/** v1.1 chunk D — merged user timeline entry. Track + error sources
 *  share a `t` + `source` discriminator. */
export type TimelineEntry =
  | {
      name: string
      props: Record<string, unknown>
      route: null | string
      source: 'track'
      t: string
    }
  | {
      environment: null | string
      errorType: string
      eventId: string
      message: string
      source: 'error'
      t: string
    }

export type ReplayFramesResponse = {
  ref: null | string
  frameCount: number
  frames: ReplayFrame[]
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

  // v1.4 W23 — cross-org integration sharing / templating.
  listIntegrationTemplates: () =>
    adminFetch<IntegrationTemplateRow[]>('/account/integration-templates'),
  createIntegrationTemplate: (body: IntegrationTemplateBody) =>
    adminFetch<IntegrationTemplateRow>('/account/integration-templates', {
      body: JSON.stringify(body),
      method: 'POST',
    }),
  updateIntegrationTemplate: (id: string, body: IntegrationTemplateBody) =>
    adminFetch<IntegrationTemplateRow>(`/account/integration-templates/${id}`, {
      body: JSON.stringify(body),
      method: 'PUT',
    }),
  deleteIntegrationTemplate: (id: string) =>
    adminFetch<null>(`/account/integration-templates/${id}`, { method: 'DELETE' }),
  applyIntegrationTemplate: (id: string, targetOrgSlug: string) =>
    adminFetch<null>(`/account/integration-templates/${id}/apply`, {
      body: JSON.stringify({ targetOrgSlug }),
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
      /** v1.2 W4 — replace the full label set; [] clears all. */
      labels?: string[]
      /** v1.2 W4 — set the triage priority. */
      priority?: IssuePriority
      resolvedInRelease?: null | string
      status?: 'active' | 'closed' | 'muted' | 'resolved' | 'silenced'
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

  /**
   * v2.1 — per-issue re-fingerprint admin tool. Two-step:
   *
   *   - `{ apply: false }` (default) → dry-run preview. Returns
   *     groups + counts + sample messages. No DB writes.
   *   - `{ apply: true, confirm: 'yes' }` → execute the migration.
   *     `confirm` is a typo-shield against accidental triggers.
   *
   * See `server/src/api/admin/refingerprint.rs` for the protocol.
   */
  refingerprintIssue: (
    projectId: string,
    issueId: string,
    body: { apply?: boolean; confirm?: string } = {}
  ) =>
    adminFetch<RefingerprintResponse>(`/projects/${projectId}/issues/${issueId}/re-fingerprint`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  /**
   * v2.2 — single query endpoint that backs every "find bug" view +
   * any LLM agent. Whitelist of dim × measure × filter; no SQL
   * passthrough. Same endpoint, same shape, used by:
   *   - dashboard module UIs (preset queries per module)
   *   - saved-view URLs (the URL encodes a query)
   *   - LLM agents calling the admin API directly
   * See `server/src/api/admin/explore.rs` for full whitelist + shape.
   */
  explore: (projectId: string, body: ExploreReq) =>
    adminFetch<ExploreResp>(`/projects/${projectId}/explore`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  /**
   * v2.2 — cross-release issue lineage. Given an issue, find other
   * issues in the same project that share `error_type` but landed
   * on a different release. Surfaces the "did this come back?"
   * intelligence without re-merging the rows (the v2.1 release-IN-
   * fingerprint trade-off). See `api/admin/related.rs`.
   */
  relatedAcrossReleases: (projectId: string, issueId: string) =>
    adminFetch<RelatedAcrossReleasesResp>(
      `/projects/${projectId}/issues/${issueId}/related-across-releases`
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

  /** v2.1 W4 — endpoint health: list all checks for a project. */
  listEndpointChecks: (projectId: string) =>
    adminFetch<EndpointCheck[]>(`/projects/${projectId}/endpoint-checks`),

  /** v2.1 W4 — create a new endpoint check. */
  createEndpointCheck: (projectId: string, body: NewEndpointCheck) =>
    adminFetch<{ id: string }>(`/projects/${projectId}/endpoint-checks`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),

  /** v2.1 W4 — get one check. */
  getEndpointCheck: (projectId: string, id: string) =>
    adminFetch<EndpointCheck>(`/projects/${projectId}/endpoint-checks/${id}`),

  /** v2.1 W4 — patch a check (any subset of fields). */
  updateEndpointCheck: (
    projectId: string,
    id: string,
    body: Partial<NewEndpointCheck> & { paused?: boolean }
  ) =>
    adminFetch<void>(`/projects/${projectId}/endpoint-checks/${id}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    }),

  /** v2.1 W4 — delete a check (cascades to its probes). */
  deleteEndpointCheck: (projectId: string, id: string) =>
    adminFetch<void>(`/projects/${projectId}/endpoint-checks/${id}`, {
      method: 'DELETE',
    }),

  /** v2.1 W4 — probe log for one check (last 24 h by default). */
  listEndpointProbes: (
    projectId: string,
    id: string,
    params: { from?: string; limit?: number; to?: string } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.from) usp.set('from', params.from)
    if (params.to) usp.set('to', params.to)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    const qs = usp.toString()
    return adminFetch<EndpointProbeRow[]>(
      `/projects/${projectId}/endpoint-checks/${id}/probes${qs ? '?' + qs : ''}`
    )
  },

  /** v2.1 W4 — 1h rollup for one check (24 h sparkline data). */
  listEndpointRollup: (
    projectId: string,
    id: string,
    params: { from?: string; to?: string } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.from) usp.set('from', params.from)
    if (params.to) usp.set('to', params.to)
    const qs = usp.toString()
    return adminFetch<EndpointRollupRow[]>(
      `/projects/${projectId}/endpoint-checks/${id}/rollup${qs ? '?' + qs : ''}`
    )
  },

  /** v2.1.3 — "Probe now" dry-run. Runs one probe against the check's
   *  current config but writes nothing to `endpoint_probe` and does
   *  not touch the issue lifecycle — purely a UX sanity-check for an
   *  operator who just edited a check. */
  probeEndpointCheckNow: (projectId: string, id: string) =>
    adminFetch<EndpointProbeNowResult>(`/projects/${projectId}/endpoint-checks/${id}/probe-now`, {
      method: 'POST',
    }),

  /** v2.1 W3 — runtime metrics BI query. Server picks the rollup
   *  tier (raw / _1m / _1h / _1d) based on the (bucket, from, to)
   *  window and returns one series per dim tuple. */
  queryRuntimeMetrics: (
    projectId: string,
    params: {
      bucket?: '1d' | '1h' | '1m' | '5m' | '15m'
      dim?: 'device_class' | 'environment' | 'none' | 'release'
      from?: string
      measure?: 'avg' | 'count' | 'p50' | 'p95' | 'p99' | 'sum'
      name: string
      to?: string
    }
  ) => {
    const usp = new URLSearchParams()
    usp.set('name', params.name)
    if (params.dim && params.dim !== 'none') usp.set('dim', params.dim)
    if (params.measure) usp.set('measure', params.measure)
    if (params.bucket) usp.set('bucket', params.bucket)
    if (params.from) usp.set('from', params.from)
    if (params.to) usp.set('to', params.to)
    return adminFetch<RuntimeMetricsQueryResponse>(
      `/projects/${projectId}/runtime-metrics/query?${usp.toString()}`
    )
  },

  /** v0.8.3 — recent points for a metric (defaults to last 24h).
   *  v2.0 W3 — `spanId` filter ties a metric query to its emitting
   *  span; drives the dashboard span detail "related metrics" row. */
  listMetrics: (
    projectId: string,
    params: { limit?: number; name?: string; since?: string; spanId?: string }
  ) => {
    const usp = new URLSearchParams()
    if (params.name) usp.set('name', params.name)
    if (params.since) usp.set('since', params.since)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.spanId) usp.set('spanId', params.spanId)
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

  /** v1.2 W2 — project-wide sourcemap upload coverage; powers the
   *  issue-detail banner that nudges operators about missing uploads. */
  sourcemapStatus: (projectId: string) =>
    adminFetch<SourcemapStatus>(`/projects/${projectId}/sourcemap-status`),

  /** v1.4 W27 — per-release source-coverage probe. Replaces v1.2
   *  W2.b's file-extension heuristic with an authoritative check
   *  against this exact release's artifacts. */
  sourceCoverage: (projectId: string, release: string) =>
    adminFetch<SourceCoverage>(
      `/projects/${projectId}/releases/${encodeURIComponent(release)}/source-coverage`
    ),

  /** v1.2 W8 — current user's notifications. */
  listNotifications: (params: { limit?: number; unread?: boolean } = {}) => {
    const usp = new URLSearchParams()
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.unread) usp.set('unread', 'true')
    const qs = usp.toString()
    return adminFetch<Notification[]>(`/notifications${qs ? '?' + qs : ''}`)
  },
  markNotificationRead: (id: number) =>
    adminFetch<null>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    adminFetch<{ updated: number }>(`/notifications/read-all`, { method: 'POST' }),

  /** v1.3 W14 — per-user notification preferences. */
  getNotificationPreferences: () =>
    adminFetch<NotificationPreferences>('/account/notification-preferences'),
  putNotificationPreferences: (body: NotificationPreferences) =>
    adminFetch<NotificationPreferences>('/account/notification-preferences', {
      body: JSON.stringify(body),
      method: 'PUT',
    }),
  /** v1.4 W16 — diagnostic test email to the caller's own address. */
  sendTestNotificationEmail: () =>
    adminFetch<TestEmailResponse>('/account/notification-preferences/test-email', {
      method: 'POST',
    }),
  /** v1.4 W17 — manually fire the digest worker for the caller, even if
   *  not yet due. Returns {sent: count}. */
  runDigestNow: () =>
    adminFetch<{ sent: number }>('/account/notification-preferences/run-digest-now', {
      method: 'POST',
    }),

  /** v1.4 W24 — per-org label catalog. */
  listOrgLabels: (orgSlug: string) =>
    adminFetch<OrgLabelRow[]>(`/orgs/${encodeURIComponent(orgSlug)}/labels`),
  createOrgLabel: (
    orgSlug: string,
    body: { name: string; color?: string; slaPriorityHours?: number }
  ) =>
    adminFetch<OrgLabelRow>(`/orgs/${encodeURIComponent(orgSlug)}/labels`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),
  updateOrgLabel: (
    orgSlug: string,
    id: string,
    body: { name: string; color?: string; slaPriorityHours?: number }
  ) =>
    adminFetch<OrgLabelRow>(`/orgs/${encodeURIComponent(orgSlug)}/labels/${id}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),
  deleteOrgLabel: (orgSlug: string, id: string) =>
    adminFetch<null>(`/orgs/${encodeURIComponent(orgSlug)}/labels/${id}`, {
      method: 'DELETE',
    }),

  /** v1.4 W22 — webhook retry queue. */
  listWebhookDeliveries: (params: { status?: string; limit?: number } = {}) => {
    const usp = new URLSearchParams()
    if (params.status !== undefined) usp.set('status', params.status)
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    const qs = usp.toString()
    return adminFetch<WebhookDeliveryRow[]>(`/webhook-deliveries${qs ? '?' + qs : ''}`)
  },
  retryWebhookDelivery: (id: string) =>
    adminFetch<null>(`/webhook-deliveries/${id}/retry`, { method: 'POST' }),

  /** v1.2 W8 + v1.4 W18 — per-issue watch + mute toggles. */
  watchStatus: (projectId: string, issueId: string) =>
    adminFetch<{ watching: boolean; muted: boolean }>(
      `/projects/${projectId}/issues/${issueId}/watch`
    ),
  watchIssue: (projectId: string, issueId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/watch`, { method: 'PUT' }),
  unwatchIssue: (projectId: string, issueId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/watch`, { method: 'DELETE' }),
  muteIssue: (projectId: string, issueId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/mute`, { method: 'PUT' }),
  unmuteIssue: (projectId: string, issueId: string) =>
    adminFetch<null>(`/projects/${projectId}/issues/${issueId}/mute`, { method: 'DELETE' }),

  /** v1.2 W7.a — per-issue external integration link list. */
  listIntegrationLinks: (projectId: string, issueId: string) =>
    adminFetch<IntegrationLink[]>(`/projects/${projectId}/issues/${issueId}/integration-links`),

  listEvents: (
    projectId: string,
    issueId: string,
    params: { before?: string; limit?: number; symbolicated?: boolean } = {}
  ) => {
    const usp = new URLSearchParams()
    if (params.limit !== undefined) usp.set('limit', String(params.limit))
    if (params.symbolicated !== undefined) usp.set('symbolicated', String(params.symbolicated))
    // v2.1 — `?before=<rfc3339>` walks the next page (events older
    // than the cursor). Dashboard's Load-older button passes the
    // oldest received_at from the current page.
    if (params.before !== undefined) usp.set('before', params.before)
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<EventRow[]>(`/projects/${projectId}/issues/${issueId}/events${qs}`)
  },

  /** F4 — platform health snapshot. Public (no auth) so the
   *  dashboard renders the strip even when not signed in. */
  selfTest: () => adminFetch<SelfTest>(`/self-test`),

  /** Analytics v1 chunk A — live-presence snapshot per project.
   *  Dashboard polls every 5 s; server reads Valkey ZSET + parallel
   *  dims hash and aggregates. */
  liveSnapshot: (projectId: string) => adminFetch<LiveSnapshot>(`/projects/${projectId}/live`),
  audienceMetrics: (
    projectId: string,
    params: { since?: string; until?: string; granularity?: 'day' | 'hour' } = {}
  ) => {
    const qs = new URLSearchParams()
    if (params.since) qs.set('since', params.since)
    if (params.until) qs.set('until', params.until)
    if (params.granularity) qs.set('granularity', params.granularity)
    const q = qs.toString()
    return adminFetch<AudienceMetrics>(`/projects/${projectId}/audience/metrics${q ? `?${q}` : ''}`)
  },

  /** v1.1 chunk S2 — Pin anomaly list (grouped by serverName) for
   *  the Posture > Pin anomaly tab. Default 24h window, limit 100. */
  pinAnomalies: (projectId: string, params: { since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.since) qs.set('since', params.since)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return adminFetch<PinAnomalyRow[]>(
      `/projects/${projectId}/security/pin-anomalies${q ? `?${q}` : ''}`
    )
  },

  /** v1.1 chunk S3 — lowest-score installs (last 24h). */
  trustScores: (projectId: string, params: { limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return adminFetch<TrustScoreRow[]>(`/projects/${projectId}/trust/scores${q ? `?${q}` : ''}`)
  },

  /** v1.1 chunk D — top routes from $pageview track events. */
  topRoutes: (projectId: string, params: { since?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.since) qs.set('since', params.since)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return adminFetch<TopRouteRow[]>(
      `/projects/${projectId}/audience/top-routes${q ? `?${q}` : ''}`
    )
  },

  /** v1.1 chunk D — merged track + error timeline for a user. */
  userTimeline: (
    projectId: string,
    userId: string,
    params: { since?: string; limit?: number } = {}
  ) => {
    const qs = new URLSearchParams()
    if (params.since) qs.set('since', params.since)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return adminFetch<TimelineEntry[]>(
      `/projects/${projectId}/users/${encodeURIComponent(userId)}/timeline${q ? `?${q}` : ''}`
    )
  },

  /** Phase 48 sub-A.2 — list every attachment the server has for an
   *  event, regardless of payload echo. Used by the dashboard's
   *  AttachmentGallery so a broken client echo never hides a screenshot. */
  listEventAttachments: (projectId: string, eventId: string) =>
    adminFetch<Attachment[]>(
      `/projects/${projectId}/events/${encodeURIComponent(eventId)}/attachments`
    ),

  /** v1.0 A3 — parsed wireframe replay frames for the latest replay
   *  attachment on this event. Returns `{ ref: null, frames: [] }`
   *  when the event has no replay attachment so the Replay tab can
   *  render a uniform empty state without a 404 branch. */
  listReplayFrames: (projectId: string, eventId: string) =>
    adminFetch<ReplayFramesResponse>(
      `/projects/${projectId}/events/${encodeURIComponent(eventId)}/replay-frames`
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

  /** v1.0 — create a project inside an org. Caller must be owner or
   *  admin of that org (server enforces). Returns the new project row. */
  createProject: (orgSlug: string, body: { name: string }) =>
    adminFetch<ProjectRow>(`/orgs/${orgSlug}/projects`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

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

  /** v1.3 W15 — delete one release_artifacts row + best-effort blob unlink. */
  deleteReleaseArtifact: (projectId: string, release: string, artifactId: string) =>
    adminFetch<null>(
      `/projects/${projectId}/releases/${encodeURIComponent(release)}/artifacts/${artifactId}`,
      { method: 'DELETE' }
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

// v1.2 W2 / W3.c — project-level upload coverage for both JS
// sourcemaps and native source bundles.
export type SourcemapStatus = {
  lastUploadedAt: null | string
  releasesTotal: number
  releasesWithAndroidBundle: number
  releasesWithIosBundle: number
  releasesWithSourcemap: number
}

// v1.4 W27 — per-release source-coverage. Used by FrameRow /
// SourceMapStatusBanner to render the exact "no source" hint that
// matches the event's release, replacing v1.2 W2.b's heuristic.
export type SourceCoverage = {
  hasAndroidBundle: boolean
  hasIosBundle: boolean
  hasJsSourcemap: boolean
}

// v1.2 W7.a — external issue tracker link (Linear / GitHub / GitLab / Jira).
export type IntegrationLink = {
  integrationKind: string
  externalId: string
  externalUrl: null | string
  externalTitle: null | string
  externalStatus: null | string
  externalUpdatedAt: null | string
  createdAt: string
}

// v1.3 W14 — per-user notification preferences.
export type NotificationPreferences = {
  mutedKinds: string[]
  cadence: string
  channels: string[]
}

// v1.4 W16 — test email diagnostic response.
export type TestEmailResponse = {
  delivered: boolean
  logId: null | number
  recipient: string
  error: null | string
}

// v1.4 W24 — org label catalog row.
export type OrgLabelRow = {
  id: string
  name: string
  color: null | string
  slaPriorityHours: null | number
  createdAt: string
}

// v1.4 W22 — webhook delivery row.
export type WebhookDeliveryRow = {
  id: string
  ruleId: string
  ruleName: null | string
  projectId: null | string
  targetUrl: string
  status: string
  attempt: number
  lastStatus: null | number
  lastError: null | string
  nextAttemptAt: string
  createdAt: string
  deliveredAt: null | string
}

// v1.2 W8 — per-user notification row.
export type Notification = {
  id: number
  issueId: string
  kind: string
  payload: Record<string, unknown>
  readAt: null | string
  createdAt: string
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

// v2.1 W3 — runtime metrics BI query response.
export type RuntimeMetricsQueryResponse = {
  /** Which rollup tier the server picked. Surfaced as a
   *  "resolution" badge in the UI. */
  tier: '1d' | '1h' | '1m' | 'raw'
  series: RuntimeMetricsSeries[]
}

export type RuntimeMetricsSeries = {
  /** Tag combo identifying the series (e.g. release=v1.0.0).
   *  Empty when `dim=none`. */
  label: string
  points: RuntimeMetricsPoint[]
}

export type RuntimeMetricsPoint = {
  ts: string
  value: number
}

// v2.1 W4 — endpoint health types.
export type EndpointCheck = {
  id: string
  projectId: string
  name: string
  targetUrl: string
  method: string
  intervalSec: number
  assertionStatusCodes: number[]
  assertionBodySubstring: null | string
  assertionMaxLatencyMs: null | number
  paused: boolean
  createdAt: string
  updatedAt: string
}

export type NewEndpointCheck = {
  name: string
  targetUrl: string
  method?: string
  intervalSec?: number
  assertionStatusCodes?: number[]
  assertionBodySubstring?: string
  assertionMaxLatencyMs?: number
}

export type EndpointProbeRow = {
  ts: string
  statusCode: number
  latencyMs: number
  ok: boolean
  errorKind: null | string
}

export type EndpointRollupRow = {
  bucketTs: string
  probeCount: number
  okCount: number
  uptimePct: number
  p50LatencyMs: number
  p95LatencyMs: number
}

// v2.1.3 — "Probe now" dry-run response shape. `errorKind` is null
// on success, otherwise one of: status / body / latency / dns / tcp /
// tls / timeout (same taxonomy the cron writes into endpoint_probe).
export type EndpointProbeNowResult = {
  ok: boolean
  statusCode: number
  latencyMs: number
  errorKind: null | string
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
// v1.2 W5/W10 added the structured variants below.
export type ActivityEntry =
  | { actorId: null | string; at: string; kind: 'resolved'; release: null | string }
  | { at: string; kind: 'regressed'; release: null | string }
  | {
      at: string
      authorEmail: null | string
      authorId: null | string
      body: string
      id: string
      kind: 'comment'
    }
  | {
      actorId: null | string
      at: string
      bulk: boolean
      from: null | string
      kind: 'statusChanged'
      to: string
    }
  | {
      actorId: null | string
      at: string
      bulk: boolean
      from: null | string
      kind: 'assigneeChanged'
      to: null | string
    }
  | {
      actorId: null | string
      at: string
      eventsMoved: null | number
      fromIssueId: null | string
      kind: 'merged'
    }
  | {
      actorId: null | string
      at: string
      from: null | string
      kind: 'priorityChanged'
      to: IssuePriority
    }
  | {
      actorId: null | string
      added: string[]
      at: string
      kind: 'labelsChanged'
      removed: string[]
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
  /** v2.4 — distinct identity fingerprints that errored on this release. */
  affectedUsers: number
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
  /** v1.3 W15 — populated for source_bundle_* rows. Null for legacy. */
  entryCount: null | number
  id: string
  /** 'sourcemap' | 'source_bundle_ios' | 'source_bundle_android' | … */
  kind: string
  /** v1.4 W26 — operator-set tag for multi-bundle uploads (main /
   *  watch-ext / share-ext). Null for legacy / single-bundle uploads. */
  moduleLabel: null | string
  name: string
  /** v1.3 W15 — total uncompressed bytes for source bundles. Null for legacy. */
  uncompressedSizeBytes: null | number
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

export type AuthUser = {
  avatarUrl?: null | string
  displayName?: null | string
  email: string
  /** True when the user verified their email via the link we sent
   *  on register. OAuth-registered users are always true. */
  emailVerified?: boolean
  id: string
  /** v1.0 — instance-wide god-mode flag. Unlocks /superadmin/*
   *  dashboard surfaces + cross-org admin endpoints. */
  isSuperadmin?: boolean
  /** Non-null when the account is linked to GitHub / Google. */
  oauthProvider?: null | string
}

/** v1.0 — rows returned by superadmin endpoints. Cross-org. */
export type SuperadminUserRow = {
  avatarUrl: null | string
  createdAt: string
  displayName: null | string
  email: string
  emailVerified: boolean
  id: string
  isSuperadmin: boolean
  oauthProvider: null | string
  orgCount: number
}

export type SuperadminOrgRow = {
  createdAt: string
  id: string
  memberCount: number
  name: string
  ownerEmail: null | string
  ownerId: string
  projectCount: number
  slug: string
}

export type SuperadminProjectRow = {
  createdAt: string
  eventCount30d: number
  id: string
  name: string
  orgId: string
  orgSlug: string
  sourceRepoUrl: null | string
}

/** v1.0 — superadmin-only API surface. Mirrors the gated
 *  `/admin/api/superadmin/*` server routes. */
export const superadminApi = {
  listOrgs: () => adminFetch<SuperadminOrgRow[]>('/superadmin/orgs'),
  listProjects: () => adminFetch<SuperadminProjectRow[]>('/superadmin/projects'),
  listUsers: () => adminFetch<SuperadminUserRow[]>('/superadmin/users'),
  setSuperadmin: (userId: string, isSuperadmin: boolean) =>
    adminFetch<{ ok: true }>(`/superadmin/users/${userId}`, {
      body: JSON.stringify({ isSuperadmin }),
      method: 'PATCH',
    }),
}

export type OAuthProviders = { github: boolean; google: boolean }

/** Phase 13 sub-B/E + v1.0: user-based auth + profile mutations. */
export const userAuthApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    authFetch<{ ok: true }>('/change-password', {
      body: JSON.stringify({ currentPassword, newPassword }),
      method: 'POST',
    }),

  forgotPassword: (email: string) =>
    authFetch<{ ok: true }>('/forgot-password', {
      body: JSON.stringify({ email }),
      method: 'POST',
    }),

  listOAuthProviders: () => authFetch<OAuthProviders>('/oauth/providers'),

  login: (email: string, password: string) =>
    authFetch<{ ok: true; user: AuthUser }>('/login', {
      body: JSON.stringify({ email, password }),
      method: 'POST',
    }),

  logout: () => authFetch<{ ok: true }>('/logout', { method: 'POST' }),

  me: () => authFetch<{ user: AuthUser }>('/me'),

  patchMe: (body: { avatarUrl?: null | string; displayName?: null | string }) =>
    authFetch<{ ok: true }>('/me', { body: JSON.stringify(body), method: 'PATCH' }),

  register: (email: string, password: string) =>
    authFetch<{ ok: true }>('/register', {
      body: JSON.stringify({ email, password }),
      method: 'POST',
    }),

  resetPassword: (token: string, password: string) =>
    authFetch<{ ok: true }>('/reset-password', {
      body: JSON.stringify({ password, token }),
      method: 'POST',
    }),

  /** Kill every session for the current user except the one this
   *  request is made from. Used by the "Sign out other devices"
   *  button on /account. */
  signOutEverywhere: () => authFetch<{ ok: true }>('/sign-out-everywhere', { method: 'POST' }),

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
/**
 * v2.3 — cross-project user lookup response shape. Mirrors
 * `server/src/api/admin/identity_lookup.rs::LookupResp`.
 *
 * Returned by `usersLookup({ keyType, clientHash })`. Empty `hits`
 * = no events with that fingerprint in the org's default identity
 * scope. Same shape whether the org has no events, the key wasn't
 * recognised, or there's just nothing matching — so the response
 * doesn't leak existence.
 */
export type IdentityProjectHit = {
  projectId: string
  eventCount: number
  firstSeen: string
  lastSeen: string
  issueCount: number
}
export type IdentityLookupResp = {
  scopeId: string
  keyType: string
  totalEvents: number
  hits: IdentityProjectHit[]
}

/**
 * v2.4 — Users page default overview. Mirrors
 * `server/src/api/admin/users_overview.rs::OverviewResp`. Fingerprints
 * surface as 64-char lowercase hex; no raw identity ever crosses the
 * wire.
 */
export type UsersOverviewTopRow = {
  fingerprintHex: string
  keyType: string
  eventCount: number
  issueCount: number
  primaryRelease: null | string
  primaryOs: null | string
  firstSeen: string
  lastSeen: string
}
export type UsersOverviewBreakdownRow = {
  label: string
  fingerprintCount: number
}
export type UsersOverviewResp = {
  scopeId: string
  windowDays: number
  kpi: {
    identifiedUsers: number
    affectedUsers: number
    crashFreeRatio: number
  }
  top: UsersOverviewTopRow[]
  breakdown: {
    byRelease: UsersOverviewBreakdownRow[]
    byKeyType: UsersOverviewBreakdownRow[]
  }
}

/**
 * v2.4 — Single-fingerprint detail response. Mirrors
 * `server/src/api/admin/users_detail.rs::DetailResp`.
 */
export type UsersDetailTimelineBucket = {
  hourBucket: string
  eventCount: number
  errorCount: number
}
export type UsersDetailTopIssue = {
  issueId: string
  projectId: string
  title: string
  eventCount: number
  lastSeen: string
}
export type UsersDetailResp = {
  scopeId: string
  fingerprintHex: string
  windowDays: number
  totalEvents: number
  hits: IdentityProjectHit[]
  timeline: UsersDetailTimelineBucket[]
  topIssues: UsersDetailTopIssue[]
}

export const orgsApi = {
  acceptInvite: (token: string) =>
    orgsFetch<{ ok: true; orgSlug: string }>(`/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    }),

  /**
   * v2.3 — cross-project user lookup. Browser hashes the operator's
   * raw input client-side via `crypto.subtle` (see
   * `web/src/lib/identity-hash.ts`); only the resulting `clientHash`
   * travels here. Raw email / phone / sub never leaves the device;
   * the server can't recover it.
   */
  usersLookup: (slug: string, body: { keyType: string; clientHash: string }) =>
    adminFetch<IdentityLookupResp>(`/orgs/${slug}/users/lookup`, {
      body: JSON.stringify(body),
      method: 'POST',
    }),

  /**
   * v2.4 — Single-fingerprint detail. Operator lands here from the
   * most-affected list (or a deep-link) with the 64-char hex.
   * Empty-shape for missing org / unknown fingerprint, same privacy
   * non-leak as the lookup endpoints.
   */
  usersDetail: (slug: string, fingerprintHex: string, opts: { days?: number } = {}) => {
    const params = new URLSearchParams()
    if (opts.days !== undefined) params.set('days', String(opts.days))
    const qs = params.toString()
    return adminFetch<UsersDetailResp>(`/orgs/${slug}/users/${fingerprintHex}${qs ? `?${qs}` : ''}`)
  },

  /**
   * v2.4 — Users page default overview. KPI + most-affected
   * fingerprints + per-release / per-key-type breakdown. Always
   * returns a payload (empty-shape for missing org), never 404.
   */
  usersOverview: (slug: string, opts: { days?: number; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (opts.days !== undefined) params.set('days', String(opts.days))
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return adminFetch<UsersOverviewResp>(`/orgs/${slug}/users/overview${qs ? `?${qs}` : ''}`)
  },

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

  /** v1.1 chunk S4 — cross-project federation lookup. Returns every
   *  project in the org that linked the given (provider, subject)
   *  pair; same Google `sub` across 3 apps shows as 3 rows. */
  federation: (slug: string, provider: string, subject: string) =>
    orgsFetch<FederationRow[]>(
      `/orgs/${slug}/federation/${encodeURIComponent(provider)}/${encodeURIComponent(subject)}`
    ),

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
