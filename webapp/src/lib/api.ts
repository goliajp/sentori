// Sentori API client — v0.1 self-hosted endpoint coverage.
//
// All calls go through `fetch` against a configurable base
// URL — defaults to the dev server's Vite proxy
// (`http://localhost:3000` → proxy → `http://localhost:8080`).

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  version: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
}

export interface Issue {
  id: string;
  fingerprint: string;
  error_type: string;
  message_sample: string;
  kind: string;
  status: 'active' | 'resolved' | 'regressed' | 'ignored';
  event_count: number;
  first_seen: string;
  last_seen: string;
  last_release: string;
  last_environment: string;
}

export interface EventRow {
  id: string;
  issue_id: string;
  kind: string;
  timestamp: string;
  release: string;
  environment: string;
  platform: string;
}

export interface IngestRequest {
  kind: 'error' | 'message' | 'anr' | 'near_crash';
  error_type: string;
  message: string;
  platform: 'ios' | 'android' | 'javascript' | 'web' | 'node';
  release?: string;
  environment?: string;
}

export interface IngestResponse {
  event_id: string;
  issue_id: string;
  is_new: boolean;
}

export interface UsageCounter {
  count: number;
  dropped: number;
  limit: number;
}

export interface UsageResponse {
  plan: 'free' | 'pro' | 'enterprise';
  status: string;
  period_yyyymm: string;
  events: UsageCounter;
  spans: UsageCounter;
  replays: UsageCounter;
}

export interface AlertRule {
  id: string;
  project_id: string | null;
  name: string;
  enabled: boolean;
  muted: boolean;
  trigger_kind: 'new_issue' | 'regression' | 'event_count' | 'crash_free_drop';
  trigger_config: unknown;
  filter_config: unknown;
  channels: unknown;
  throttle_minutes: number;
  last_fired_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  project_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: unknown;
  created_at: string;
}

export interface CertObservation {
  id: string;
  project_id: string;
  domain: string;
  common_name: string | null;
  issuer_name: string;
  not_before: string;
  not_after: string;
  observed_at: string;
}

export interface SavedView {
  id: string;
  project_id: string | null;
  target: 'issues' | 'events' | 'spans' | 'replays' | 'metrics';
  scope: 'personal' | 'workspace';
  name: string;
  payload: unknown;
  created_at: string;
}

export interface TokenSummary {
  id: string;
  kind: 'public' | 'admin';
  label: string | null;
  last4: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface PushCredential {
  id: string;
  kind: string;
  config: unknown;
  created_at: string;
  last_validated_at: string | null;
  last_validate_status: string | null;
}

export interface MemberRow {
  user_id: string;
  role: 'owner' | 'admin' | 'user';
  added_by: string | null;
  added_at: string;
}

export interface InviteRow {
  id: string;
  email: string;
  role: 'admin' | 'user';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface IntegrationRow {
  id: string;
  kind: string;
  config: unknown;
  connected_by: string | null;
  connected_at: string;
  active: boolean;
}

export interface ReleaseRow {
  id: string;
  name: string;
  created_at: string;
  deploy_at: string | null;
}

export interface ReleaseArtifact {
  id: string;
  kind: string;
  name: string;
  content_hash: string;
  size_bytes: number;
  created_at: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  project_count: number;
  member_count: number;
  created_at: string;
}

export interface SaasStats {
  workspaces: number;
  active_workspaces: number;
  projects: number;
  users: number;
}

const DEFAULT_BASE = '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`);
  }
}

export class Api {
  constructor(private baseUrl: string = DEFAULT_BASE) {}

  health(): Promise<HealthResponse> {
    return this.get('/healthz');
  }
  listProjects(): Promise<Project[]> {
    return this.get('/v1/projects');
  }
  listIssues(
    projectId: string,
    opts: { status?: string; limit?: number } = {},
  ): Promise<Issue[]> {
    const qs = buildQS({ status: opts.status, limit: opts.limit });
    return this.get(`/v1/projects/${projectId}/issues${qs}`);
  }
  listEvents(
    projectId: string,
    opts: { issue_id?: string; limit?: number } = {},
  ): Promise<EventRow[]> {
    const qs = buildQS({ issue_id: opts.issue_id, limit: opts.limit });
    return this.get(`/v1/projects/${projectId}/events${qs}`);
  }
  ingestEvent(
    projectId: string,
    body: IngestRequest,
  ): Promise<IngestResponse> {
    return this.post(`/v1/events/${projectId}`, body);
  }
  usage(): Promise<UsageResponse> {
    return this.get('/v1/usage');
  }
  listAlerts(): Promise<AlertRule[]> {
    return this.get('/v1/alerts');
  }
  listAlertsForProject(projectId: string): Promise<AlertRule[]> {
    return this.get(`/v1/projects/${projectId}/alerts`);
  }
  createAlert(body: unknown): Promise<{ id: string }> {
    return this.post('/v1/alerts', body);
  }
  patchAlert(id: string, body: unknown): Promise<void> {
    return this.send(`/v1/alerts/${id}`, 'PATCH', body);
  }
  deleteAlert(id: string): Promise<void> {
    return this.send(`/v1/alerts/${id}`, 'DELETE');
  }
  listAudit(opts: {
    project_id?: string;
    actor_user_id?: string;
    action?: string;
    limit?: number;
  } = {}): Promise<AuditEntry[]> {
    const qs = buildQS(opts as Record<string, string | number | undefined>);
    return this.get(`/v1/audit${qs}`);
  }
  listCertObservations(projectId: string): Promise<CertObservation[]> {
    return this.get(`/v1/projects/${projectId}/cert/observations`);
  }
  listSavedViews(
    target: string,
    projectId?: string,
  ): Promise<SavedView[]> {
    const qs = buildQS({ target, project_id: projectId });
    return this.get(`/v1/saved-views${qs}`);
  }
  createSavedView(body: unknown): Promise<{ id: string }> {
    return this.post('/v1/saved-views', body);
  }
  deleteSavedView(id: string): Promise<void> {
    return this.send(`/v1/saved-views/${id}`, 'DELETE');
  }

  // ── auth: dashboard user lifecycle ─────────────────────
  authRegister(body: { email: string; password: string }): Promise<{
    user_id: string;
    verify_token: string;
  }> {
    return this.post('/auth/register', body);
  }
  authLogin(body: { email: string; password: string }): Promise<{
    user_id: string;
    email: string;
    session_token: string;
    expires_at: string;
  }> {
    return this.post('/auth/login', body);
  }
  authVerify(token: string): Promise<{ user_id: string }> {
    return this.post('/auth/verify', { token });
  }
  authForgotPassword(email: string): Promise<{ reset_token?: string }> {
    return this.post('/auth/forgot-password', { email });
  }
  authResetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ user_id: string }> {
    return this.post('/auth/reset-password', {
      token,
      new_password: newPassword,
    });
  }

  // ── admin: tokens ──────────────────────────────────────
  listTokens(projectId: string): Promise<{ tokens: TokenSummary[] }> {
    return this.get(`/admin/api/projects/${projectId}/tokens`);
  }
  mintToken(
    projectId: string,
    body: { label?: string; kind?: 'public' | 'admin' },
  ): Promise<{ token_id: string; token: string; kind: string; label?: string }> {
    return this.post(`/admin/api/projects/${projectId}/tokens`, body);
  }
  revokeToken(tokenId: string): Promise<void> {
    return this.send(`/admin/api/tokens/${tokenId}`, 'DELETE');
  }

  // ── admin: projects CRUD ───────────────────────────────
  createProject(body: { name: string; slug: string }): Promise<Project> {
    return this.post('/admin/api/projects', body);
  }
  getProject(projectId: string): Promise<Project> {
    return this.get(`/admin/api/projects/${projectId}`);
  }
  renameProject(projectId: string, name: string): Promise<void> {
    return this.send(`/admin/api/projects/${projectId}`, 'PATCH', { name });
  }
  deleteProject(projectId: string): Promise<void> {
    return this.send(`/admin/api/projects/${projectId}`, 'DELETE');
  }

  // ── admin: push credentials ────────────────────────────
  listPushCredentials(
    projectId: string,
  ): Promise<{ credentials: PushCredential[] }> {
    return this.get(`/admin/api/projects/${projectId}/push/credentials`);
  }
  upsertPushCredential(
    projectId: string,
    body: { provider: string; config: unknown; secret?: string },
  ): Promise<{ id: string; provider: string }> {
    return this.post(
      `/admin/api/projects/${projectId}/push/credentials`,
      body,
    );
  }
  deletePushCredential(projectId: string, kind: string): Promise<void> {
    return this.send(
      `/admin/api/projects/${projectId}/push/credentials/${kind}`,
      'DELETE',
    );
  }

  // ── admin: members ─────────────────────────────────────
  listMembers(): Promise<{ members: MemberRow[] }> {
    return this.get('/admin/api/members');
  }
  updateMemberRole(userId: string, role: 'admin' | 'user'): Promise<void> {
    return this.send(`/admin/api/members/${userId}`, 'PATCH', { role });
  }
  removeMember(userId: string): Promise<void> {
    return this.send(`/admin/api/members/${userId}`, 'DELETE');
  }

  // ── admin: invites ─────────────────────────────────────
  listInvites(): Promise<{ invites: InviteRow[] }> {
    return this.get('/admin/api/invites');
  }
  mintInvite(body: {
    email: string;
    role: 'admin' | 'user';
    invited_by: string;
    expires_in_days?: number;
  }): Promise<{ invite_id: string; token: string; expires_at: string }> {
    return this.post('/admin/api/invites', body);
  }
  revokeInvite(id: string): Promise<void> {
    return this.send(`/admin/api/invites/${id}`, 'DELETE');
  }

  // ── admin: integrations ────────────────────────────────
  listIntegrations(projectId: string): Promise<{ integrations: IntegrationRow[] }> {
    return this.get(`/admin/api/projects/${projectId}/integrations`);
  }
  upsertIntegration(
    projectId: string,
    body: { kind: string; config: unknown; connected_by?: string },
  ): Promise<{ id: string; kind: string }> {
    return this.post(`/admin/api/projects/${projectId}/integrations`, body);
  }
  deleteIntegration(projectId: string, kind: string): Promise<void> {
    return this.send(
      `/admin/api/projects/${projectId}/integrations/${kind}`,
      'DELETE',
    );
  }
  setIntegrationActive(
    projectId: string,
    kind: string,
    active: boolean,
  ): Promise<void> {
    return this.send(
      `/admin/api/projects/${projectId}/integrations/${kind}/active`,
      'PATCH',
      { active },
    );
  }

  // ── admin: releases ────────────────────────────────────
  listReleases(projectId: string): Promise<{ releases: ReleaseRow[] }> {
    return this.get(`/admin/api/projects/${projectId}/releases`);
  }
  listArtifacts(
    projectId: string,
    releaseId: string,
  ): Promise<{ artifacts: ReleaseArtifact[] }> {
    return this.get(
      `/admin/api/projects/${projectId}/releases/${releaseId}/artifacts`,
    );
  }
  deleteRelease(releaseId: string): Promise<void> {
    return this.send(`/admin/api/releases/${releaseId}`, 'DELETE');
  }

  // ── saas: cross-workspace ──────────────────────────────
  listWorkspaces(): Promise<{ workspaces: WorkspaceRow[] }> {
    return this.get('/admin/api/saas/workspaces');
  }
  saasStats(): Promise<SaasStats> {
    return this.get('/admin/api/saas/stats');
  }

  private authHeaders(): HeadersInit {
    const token = typeof localStorage !== 'undefined'
      ? localStorage.getItem('sentori_session')
      : null;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return (await r.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return (await r.json()) as T;
  }

  private async send(
    path: string,
    method: 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<void> {
    const baseHeaders = this.authHeaders();
    const headers: HeadersInit = body
      ? { 'content-type': 'application/json', ...baseHeaders }
      : baseHeaders;
    const r = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
  }
}

function buildQS(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `?${qs}`;
}

export const api = new Api();
