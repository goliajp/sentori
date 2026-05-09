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

export type IssueRow = {
  errorType: string
  eventCount: number
  fingerprint: string
  firstSeen: string
  id: string
  lastEnvironment: null | string
  lastRelease: null | string
  lastSeen: string
  messageSample: string
  status: 'active' | 'closed' | 'silenced'
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
  kind: 'error'
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
    body: { status?: 'active' | 'closed' | 'silenced' }
  ) =>
    adminFetch<IssueRow>(`/projects/${projectId}/issues/${issueId}`, {
      body: JSON.stringify(body),
      method: 'PATCH',
    }),

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
    const qs = usp.toString() ? `?${usp.toString()}` : ''
    return adminFetch<IssueRow[]>(`/projects/${projectId}/issues${qs}`)
  },

  listProjects: () => adminFetch<ProjectRow[]>('/projects'),

  listReleasesForIssue: (projectId: string, issueId: string) =>
    adminFetch<string[]>(`/projects/${projectId}/issues/${issueId}/releases`),
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

export type OrgRole = 'admin' | 'member' | 'owner'

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

  createInvite: (slug: string, email: string, role: OrgRole) =>
    orgsFetch<{ token: string }>(`/orgs/${slug}/invites`, {
      body: JSON.stringify({ email, role }),
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
