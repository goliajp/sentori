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

const adminFetch = <T>(path: string, init?: RequestInit) => apiFetch<T>(ADMIN_BASE, path, init)
const authFetch = <T>(path: string, init?: RequestInit) => apiFetch<T>(AUTH_BASE, path, init)

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
