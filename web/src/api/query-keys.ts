// v1.1 P3 — typed query key factory.
//
// Centralises every react-query key in one place so:
//   - Typos in `queryKey: ['issues', projectId]` become compile errors.
//   - `qc.invalidateQueries(qk.issues.list(projectId))` matches the
//     same source-of-truth shape the producing query used.
//   - Cache-persistence patterns (the F3 `meta.persist` opt-in) can
//     attach to a known key without copy-paste drift.
//
// Pattern: each namespace exposes either a static `all` (for
// "everything in this domain") or per-resource factories. Factories
// always return `as const` tuples so `useQuery`'s key inference
// keeps the structural shape narrow.
//
// Anything not here is a bug. The eslint rule that enforces this
// lands in P3 follow-up; for now, search-and-replace covers all 74
// existing call sites.

const tuple = <T extends readonly unknown[]>(...args: T) => args as unknown as Readonly<T>

// Most call sites guard their queries with `enabled: !!projectId`,
// so the factory accepts the nullable narrowing inputs directly —
// the cache key still contains the null, which is exactly what
// react-query keys off of. Narrowing the SQL-shaped wrapper would
// force every caller to `projectId!` which is uglier than the
// occasional null entry in the key array.
type Id = null | string | undefined

export const qk = {
  // ── global ──────────────────────────────────────────────────────────
  me: () => tuple('me'),
  oauthProviders: () => tuple('oauth-providers'),
  selfTest: () => tuple('self-test'),
  cmdk: (query: string) => tuple('cmdk', query),

  // ── org / membership ────────────────────────────────────────────────
  orgs: {
    all: () => tuple('orgs'),
    members: (orgSlug: Id) => tuple('members', orgSlug),
    teams: (orgSlug: Id) => tuple('teams', orgSlug),
    federation: (orgSlug: Id, provider: string, subject: string) =>
      tuple('federation', orgSlug, provider, subject),
    // v1.4 W24
    labels: (orgSlug: Id) => tuple('org-labels', orgSlug),
  },

  // ── project list ────────────────────────────────────────────────────
  projects: () => tuple('projects'),
  tokens: (projectId: Id) => tuple('tokens', projectId),

  // ── issues ──────────────────────────────────────────────────────────
  issue: {
    list: (projectId: Id, tab?: string) =>
      tab === undefined ? tuple('issues', projectId) : tuple('issues', projectId, tab),
    detail: (projectId: Id, issueId: Id) => tuple('issue', projectId, issueId),
    events: (projectId: Id, issueId: Id) => tuple('events', projectId, issueId),
    releases: (projectId: Id, issueId: Id) => tuple('issue-releases', projectId, issueId),
    activity: (projectId: Id, issueId: Id) => tuple('issue-activity', projectId, issueId),
    userReports: (projectId: Id, issueId: Id) => tuple('issue-user-reports', projectId, issueId),
    culprits: (projectId: Id, issueId: Id) => tuple('culprits', projectId, issueId),
    // v2.4 — find-user lens: per-issue affected fingerprints panel.
    affectedUsers: (projectId: Id, issueId: Id, days: number) =>
      tuple('issue-affected-users', projectId, issueId, days),
  },

  // ── traces ──────────────────────────────────────────────────────────
  traces: {
    list: (projectId: Id) => tuple('traces', projectId),
    detail: (projectId: Id, traceId: Id) => tuple('trace-detail', projectId, traceId),
  },

  // ── single-event sub-resources (the issue-detail "flicker" surface) ─
  event: {
    attachments: (projectId: Id, eventId: Id) => tuple('event-attachments', projectId, eventId),
    frameSource: (projectId: Id, eventId: Id, frame: number, lines: number) =>
      tuple('frame-source', projectId, eventId, frame, lines),
    replay: (eventId: Id, attachmentRef: Id) => tuple('replay', eventId, attachmentRef),
    replayNdjson: (eventId: Id, replayRef: null | string) =>
      tuple('replay-ndjson', eventId, replayRef),
    viewTree: (eventId: Id, attachmentRef: Id) => tuple('view-tree', eventId, attachmentRef),
    sessionTrail: (eventId: Id, attachmentRef: Id) =>
      tuple('session-trail', eventId, attachmentRef),
    stateSnapshot: (eventId: Id, attachmentRef: Id) =>
      tuple('state-snapshot', eventId, attachmentRef),
  },

  // ── audience / analytics ────────────────────────────────────────────
  audience: {
    live: (projectId: Id) => tuple('audience-live', projectId),
    metrics: (projectId: Id, granularity: 'day' | 'hour' = 'day') =>
      tuple('audience-metrics', projectId, granularity),
    topRoutes: (projectId: Id, window = '7d') => tuple('audience-top-routes', projectId, window),
    userTimeline: (projectId: Id, userId: Id) => tuple('user-timeline', projectId, userId),
  },
  liveDetail: (projectId: Id) => tuple('live', projectId),

  // ── posture / security ──────────────────────────────────────────────
  posture: {
    pinAnomalies: (projectId: Id, window = '24h') => tuple('pin-anomalies', projectId, window),
    trustScores: (projectId: Id) => tuple('trust-scores', projectId),
  },

  // ── v2.1 W4: endpoint health ────────────────────────────────────────
  endpointChecks: {
    list: (projectId: Id) => tuple('endpoint-checks', projectId),
    detail: (projectId: Id, id: Id) => tuple('endpoint-check', projectId, id),
    probes: (projectId: Id, id: Id, from: string, to: string) =>
      tuple('endpoint-check-probes', projectId, id, from, to),
    rollup: (projectId: Id, id: Id, from: string, to: string) =>
      tuple('endpoint-check-rollup', projectId, id, from, to),
  },

  // ── metrics / moments / vitals ──────────────────────────────────────
  metrics: {
    names: (projectId: Id) => tuple('metric-names', projectId),
    points: (projectId: Id, name: Id) => tuple('metric-points', projectId, name),
    /** v2.1 W3 — runtime metrics BI query. Folds every dim into
     *  the cache key so different slices don't collide. */
    runtime: (
      projectId: Id,
      name: string,
      dim: string,
      measure: string,
      bucket: string,
      from: string,
      to: string
    ) => tuple('runtime-metrics-query', projectId, name, dim, measure, bucket, from, to),
  },
  moments: {
    list: (projectId: Id) => tuple('moments', projectId),
    samples: (projectId: Id, name: Id) => tuple('moment-samples', projectId, name),
  },
  vitals: {
    report: (projectId: Id, release: null | string = null) =>
      tuple('vitals-report', projectId, release),
    releases: (projectId: Id) => tuple('vitals-releases', projectId),
  },

  // ── releases / integrations / cert-monitor ──────────────────────────
  releases: (projectId: Id, windowKey?: string) =>
    windowKey === undefined
      ? tuple('releases', projectId)
      : tuple('releases', projectId, windowKey),

  // ── v2.2 W3: /explore consumers ─────────────────────────────────────
  // Distinct namespace so the explore-driven Issues list doesn't share
  // cache with the legacy `listIssuesPage` consumer behind ?legacy=1.
  // Each call site provides its full payload as part of the key so the
  // cache reflects the actual server query (window / measure / filters
  // all live in the key).
  exploreIssues: (
    projectId: Id,
    measure: string,
    windowKey: string,
    status: string,
    release: string,
    errorType: string,
    env: string,
    // v2.3 — server-side search (filters.search). Added to the key
    // so the cached result distinguishes "TypeError" vs "Network".
    search: string
  ) =>
    tuple('explore-issues', projectId, measure, windowKey, status, release, errorType, env, search),
  // v2.3 — per-issue sparkline. Each Issues rail row fetches one
  // `dim=time_bucket` query keyed on (project, issue, window).
  exploreIssueSparkline: (projectId: Id, issueId: Id, windowKey: string) =>
    tuple('explore-issue-sparkline', projectId, issueId, windowKey),
  releaseArtifacts: (projectId: Id, release: string) =>
    tuple('release-artifacts', projectId, release),
  sourcemapStatus: (projectId: Id) => tuple('sourcemap-status', projectId),
  // v1.4 W27 — per-release source-coverage probe key.
  sourceCoverage: (projectId: Id, release: string) => tuple('source-coverage', projectId, release),

  // ── v1.2 W8: notifications + watch ──────────────────────────────────
  notifications: {
    unread: () => tuple('notifications', 'unread'),
    recent: () => tuple('notifications', 'recent'),
  },
  watchStatus: (projectId: Id, issueId: Id) => tuple('watch-status', projectId, issueId),

  // ── v1.3 W14: per-user notification preferences ─────────────────────
  account: {
    notificationPreferences: () => tuple('account', 'notification-preferences'),
  },

  // ── v1.4 W22: webhook retry queue ───────────────────────────────────
  webhookDeliveries: (status: string) => tuple('webhook-deliveries', status),

  // ── v1.4 W24: per-org label catalog ─────────────────────────────────
  // Extension of the existing `orgs.*` namespace.
  integrations: () => tuple('integrations'),
  // v1.4 W23 — cross-org integration sharing / templating.
  integrationTemplates: () => tuple('integration-templates'),
  certWatchDomains: (projectId: Id) => tuple('cert-watch-domains', projectId),
  certObservations: (projectId: Id, domain?: string) =>
    domain === undefined
      ? tuple('cert-observations', projectId)
      : tuple('cert-observations', projectId, domain),

  // v2.11 — push credentials per project.
  pushCredentials: (projectId: Id) => tuple('push-credentials', projectId),

  // v2.19 — push monitoring + management.
  push: {
    stats: (projectId: Id) => tuple('push-stats', projectId),
    // v2.24 — per-provider health (invalid-rate gauge).
    health: (projectId: Id) => tuple('push-health', projectId),
    // v2.27 — downstream impact (events correlated to this push).
    sendDownstream: (projectId: Id, sendId: string) =>
      tuple('push-send-downstream', projectId, sendId),
    devices: (projectId: Id, provider?: string) =>
      provider === undefined
        ? tuple('push-devices', projectId)
        : tuple('push-devices', projectId, provider),
    sends: (
      projectId: Id,
      filters: { status?: string; provider?: string; tokenId?: string } = {}
    ) =>
      tuple(
        'push-sends',
        projectId,
        filters.status ?? '_',
        filters.provider ?? '_',
        filters.tokenId ?? '_'
      ),
    sendDetail: (projectId: Id, sendId: Id) => tuple('push-send-detail', projectId, sendId),
    verify: (projectId: Id, provider: string) => tuple('push-verify', projectId, provider),
    fleet: (orgSlug: Id) => tuple('push-fleet', orgSlug),
  },

  // ── privacy ─────────────────────────────────────────────────────────
  privacy: {
    score: (projectId: Id) => tuple('privacy-score', projectId),
    findings: (projectId: Id) => tuple('privacy-findings', projectId),
  },

  // ── users (v2.4 identity overview) ──────────────────────────────────
  users: {
    detail: (orgSlug: Id, fingerprintHex: Id, days: number) =>
      tuple('users-detail', orgSlug, fingerprintHex, days),
    overview: (orgSlug: Id, days: number) => tuple('users-overview', orgSlug, days),
  },

  // ── alerts / audit / superadmin ─────────────────────────────────────
  alertRules: (projectId: Id) => tuple('alert-rules', projectId),
  audit: (orgSlug: Id) => tuple('audit', orgSlug),
  superadmin: {
    users: () => tuple('superadmin', 'users'),
    orgs: () => tuple('superadmin', 'orgs'),
    projects: () => tuple('superadmin', 'projects'),
  },
  userActivity: (userId?: Id) =>
    userId === undefined ? tuple('user-activity') : tuple('user-activity', userId),
} as const
