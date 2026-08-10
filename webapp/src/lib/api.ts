// The dashboard's typed fetch client — one class, one method per
// server route, same-origin cookies. The surface mirrors
// self-hosted/server/src/handlers exactly; if a method has no
// server route, it does not belong here.

export type Role = 'admin' | 'superadmin';

export type Me = {
  userId: string;
  email: string;
  displayName: string | null;
  role: Role;
};

export type Project = {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
};

export type IssueSummary = {
  id: string;
  projectId: string;
  kind: 'assert' | 'error' | 'probe' | 'trace' | 'warn';
  title: string;
  messageSample: string;
  surface: Record<string, unknown>;
  status: 'ignored' | 'open' | 'resolved';
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  usersCount: number;
  maxPerUser: number;
  lastRelease: string;
  assigneeUserId: string | null;
  resolvedAt: string | null;
  resolvedInRelease: string | null;
  regressedAt: string | null;
  regressedInRelease: string | null;
  /** NULL on pre-split historical issues (aggregated across
   *  environments/platforms before server 2.9). */
  environment?: string | null;
  platform?: string | null;
};

export type IssueReleaseRow = {
  release: string;
  events: number;
  firstAt: string;
  lastAt: string;
};

export type IssueActivity = {
  id: string;
  at: string;
  kind: 'assign' | 'note' | 'regression' | 'status';
  body: Record<string, unknown>;
  actorUserId: string | null;
  actorEmail: string | null;
};

export type IssueDetail = IssueSummary & {
  activity: IssueActivity[];
  releases?: IssueReleaseRow[];
};

export type OccurrenceRow = {
  id: string;
  kind: string;
  platform: string;
  occurredAt: string;
  receivedAt: string;
  release: string;
  environment: string;
  userKey: string | null;
  /** Ref of this event's `screens` attachment, when it has one —
   *  lets the replay dock fall back to the newest occurrence that
   *  actually captured pixels. */
  screensRef: string | null;
};

export type AttachmentRow = {
  ref: string;
  kind: string;
  mediaType: string;
  sizeBytes: number;
  capturedAt: string;
};

export type EventDetail = {
  id: string;
  projectId: string;
  issueId: string;
  kind: string;
  platform: string;
  occurredAt: string;
  receivedAt: string;
  release: string;
  environment: string;
  userKey: string | null;
  payload: Record<string, unknown>;
  attachments: AttachmentRow[];
};

export type ProjectHealth = {
  /** Null until the SDK carries a backendHealthUrl for the project. */
  backend: null | {
    url: string;
    lastOk: boolean | null;
    lastStatus: number | null;
    lastLatencyMs: number | null;
    lastCheckedAt: null | string;
    checks24h: number;
    ok24h: number;
  };
  lastEventAt: null | string;
  counts24h: Record<string, number>;
  users24h: number;
  platforms24h: Record<string, number>;
  latestRelease: null | string;
  latestReleaseArtifacts: string[];
  replay24h: { eligible: number; withScreens: number };
};

export type ContextEventRow = {
  id: string;
  issueId: string;
  kind: IssueSummary['kind'];
  name: string;
  occurredAt: string;
};

export type TokenRow = {
  id: string;
  name: string;
  scope: 'api' | 'ingest';
  last4: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type UserRow = {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  projects: string[];
};

export type ReleaseRow = {
  id: string;
  name: string;
  created_at?: string;
  createdAt?: string;
  /** Platforms that actually reported events in this release — a
   *  missing artifact only matters for a platform that is sending. */
  platforms?: string[];
};

export type ArtifactRow = {
  id: string;
  kind: string;
  name: string;
  content_hash?: string;
  size_bytes?: number;
  created_at?: string;
  /** Parsed at upload. `null`/absent on artifacts stored before the
   *  check existed — never looked at, which is not the same claim as
   *  looked at and fine. `false` symbolicates nothing. */
  usable?: boolean | null;
};

export type AuditRow = {
  id: string;
  projectId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** A provider credential as the dashboard sees it — never the secret
 *  itself, only whether one is there and whether it last worked. */
export type PushCredential = {
  id: string;
  kind: string;
  /** Redacted shape from the server; the secret never leaves it. */
  config: Record<string, unknown>;
  created_at?: string;
  last_validated_at?: null | string;
  last_validate_status?: null | string;
};

export type PushSend = {
  id: string;
  token_id: string;
  provider: string;
  status: string;
  provider_outcome?: null | string;
  error?: null | string;
  retry_count: number;
  created_at: string;
  sent_at?: null | string;
  next_attempt_at?: null | string;
};

export type PushHealth = {
  sent24h: number;
  failed24h: number;
  queued: number;
  lastSendAt: null | string;
  liveTokens: number;
  quarantinedTokens: number;
  /** Devices carrying a user key — the ones an issue can address.
   *  The rest can only be broadcast to. */
  identifiedTokens: number;
  /** Why the failures failed. "12 failed" is an alarm; "12 failed,
   *  BadDeviceToken" is a fix. */
  reasons: { reason: string; count: number }[];
};

export type SmtpStatus =
  | { configured: true; host: string; from: string }
  | { configured: false };

export type NotificationPref = {
  projectId: string;
  projectName: string;
  onNewIssue: boolean;
  onRegression: boolean;
};

const DEFAULT_BASE = '';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

class Api {
  base = DEFAULT_BASE;

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.base}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (resp.status === 401) {
      this.handleAuthFailure(path);
    }
    if (!resp.ok) {
      let detail = '';
      try {
        const j = (await resp.json()) as { error?: string };
        detail = j.error ?? '';
      } catch {
        // non-JSON error body
      }
      throw new ApiError(resp.status, detail || `${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }
  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>('POST', path, body ?? {});
  }

  /** On 401 anywhere: stash the return path and go to /login. */
  private handleAuthFailure(path: string): void {
    const here = window.location.pathname;
    if (here === '/login' || path === '/auth/login') return;
    sessionStorage.setItem('sentori_return_to', here + window.location.search);
    window.location.href = '/login';
  }

  // ── auth ──
  login(email: string, password: string) {
    return this.send<{ userId: string; role: Role }>('POST', '/auth/login', {
      email,
      password,
    });
  }
  logout() {
    return this.post<{ ok: boolean }>('/auth/logout');
  }
  authMe() {
    return this.get<Me>('/auth/me');
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.post<{ ok: boolean }>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
  }
  forgotPassword(email: string) {
    return this.send<{ ok: boolean }>('POST', '/auth/forgot-password', { email });
  }
  resetPassword(token: string, newPassword: string) {
    return this.send<{ ok: boolean }>('POST', '/auth/reset-password', {
      token,
      newPassword,
    });
  }

  // ── projects ──
  listProjects() {
    return this.get<{ projects: Project[] }>('/admin/api/projects');
  }
  createProject(name: string, platform?: string) {
    return this.post<{ id: string }>('/admin/api/projects', { name, platform });
  }
  updateProject(id: string, patch: { name?: string; platform?: string }) {
    return this.send<{ ok: boolean }>('PATCH', `/admin/api/projects/${id}`, patch);
  }
  deleteProject(id: string) {
    return this.send<{ ok: boolean }>('DELETE', `/admin/api/projects/${id}`);
  }

  // ── tokens ──
  listTokens(projectId: string) {
    return this.get<{ tokens: TokenRow[] }>(`/admin/api/projects/${projectId}/tokens`);
  }
  createToken(projectId: string, name: string, scope: 'api' | 'ingest') {
    return this.post<{ id: string; token: string }>(
      `/admin/api/projects/${projectId}/tokens`,
      { name, scope },
    );
  }
  revokeToken(tokenId: string) {
    return this.send<{ ok: boolean }>('DELETE', `/admin/api/tokens/${tokenId}`);
  }

  // ── users + assignments (owner) ──
  listUsers() {
    return this.get<{ users: UserRow[] }>('/admin/api/users');
  }
  createUser(email: string, password: string, displayName?: string) {
    return this.post<{ id: string }>('/admin/api/users', {
      email,
      password,
      displayName,
    });
  }
  deleteUser(userId: string) {
    return this.send<{ ok: boolean }>('DELETE', `/admin/api/users/${userId}`);
  }
  assignProject(userId: string, projectId: string) {
    return this.send<{ ok: boolean }>(
      'PUT',
      `/admin/api/users/${userId}/projects/${projectId}`,
    );
  }
  unassignProject(userId: string, projectId: string) {
    return this.send<{ ok: boolean }>(
      'DELETE',
      `/admin/api/users/${userId}/projects/${projectId}`,
    );
  }

  /** What the SDK's own traffic says about a project's deployment. */
  projectHealth(id: string) {
    return this.get<ProjectHealth>(`/admin/api/projects/${id}/health`);
  }

  // ── issues ──
  listIssues(q: {
    status?: string;
    kind?: string;
    projectId?: string;
    limit?: number;
    environment?: string;
    contextKey?: string;
    contextValue?: string;
    release?: string;
  }) {
    const usp = new URLSearchParams();
    if (q.status) usp.set('status', q.status);
    if (q.kind) usp.set('kind', q.kind);
    if (q.projectId) usp.set('project_id', q.projectId);
    if (q.limit) usp.set('limit', String(q.limit));
    if (q.environment) usp.set('environment', q.environment);
    if (q.contextKey && q.contextValue) {
      usp.set('context_key', q.contextKey);
      usp.set('context_value', q.contextValue);
    }
    if (q.release) usp.set('release', q.release);
    const qs = usp.toString();
    return this.get<{ issues: IssueSummary[] }>(`/admin/api/issues${qs ? `?${qs}` : ''}`);
  }
  /** Deployment environments this project's events have reported. */
  projectEnvironments(projectId: string) {
    return this.get<{ environments: string[] }>(
      `/admin/api/projects/${projectId}/environments`,
    );
  }
  /** Context keys this project's events have reported — slicing
   *  dimensions whose meaning belongs to the host, not to Sentori. */
  projectContextKeys(projectId: string) {
    return this.get<{ keys: string[] }>(
      `/admin/api/projects/${projectId}/context-keys`,
    );
  }
  projectContextValues(projectId: string, key: string) {
    return this.get<{ values: string[] }>(
      `/admin/api/projects/${projectId}/context-values?key=${encodeURIComponent(key)}`,
    );
  }
  getIssue(id: string) {
    return this.get<IssueDetail>(`/admin/api/issues/${id}`);
  }
  resolveIssue(id: string, release?: string, note?: string) {
    return this.post<{ ok: boolean }>(`/admin/api/issues/${id}/resolve`, {
      release,
      note,
    });
  }
  ignoreIssue(id: string) {
    return this.post<{ ok: boolean }>(`/admin/api/issues/${id}/ignore`);
  }
  reopenIssue(id: string) {
    return this.post<{ ok: boolean }>(`/admin/api/issues/${id}/reopen`);
  }
  assignIssue(id: string, userId: string | null) {
    return this.post<{ ok: boolean }>(`/admin/api/issues/${id}/assign`, { userId });
  }
  addNote(id: string, body: string) {
    return this.post<{ ok: boolean }>(`/admin/api/issues/${id}/notes`, { body });
  }
  listOccurrences(id: string) {
    return this.get<{ events: OccurrenceRow[] }>(`/admin/api/issues/${id}/events`);
  }

  // ── events + attachments ──
  getEvent(id: string) {
    return this.get<EventDetail>(`/admin/api/events/${id}`);
  }
  attachmentUrl(ref: string): string {
    return `${this.base}/admin/api/attachments/${ref}`;
  }

  /** The other events this user's app reported in the minute
   *  around this one — the case timeline's third lane. */
  eventContext(id: string) {
    return this.get<{ events: ContextEventRow[] }>(`/admin/api/events/${id}/context`);
  }

  // ── releases ──
  listReleases(projectId: string) {
    return this.get<{ releases: ReleaseRow[] }>(
      `/admin/api/projects/${projectId}/releases`,
    );
  }
  listArtifacts(projectId: string, releaseId: string) {
    return this.get<{ artifacts: ArtifactRow[] }>(
      `/admin/api/projects/${projectId}/releases/${releaseId}/artifacts`,
    );
  }

  // ── push ──
  pushHealth(projectId: string) {
    return this.get<PushHealth>(`/admin/api/projects/${projectId}/push/health`);
  }
  pushCredentials(projectId: string) {
    return this.get<{ credentials: PushCredential[] }>(
      `/admin/api/projects/${projectId}/push/credentials`,
    );
  }
  savePushCredential(
    projectId: string,
    provider: string,
    config: Record<string, unknown>,
    secret?: string,
  ) {
    return this.post<{ id: string }>(
      `/admin/api/projects/${projectId}/push/credentials`,
      { provider, config, secret },
    );
  }
  deletePushCredential(projectId: string, kind: string) {
    return this.send<{ ok: boolean }>(
      'DELETE',
      `/admin/api/projects/${projectId}/push/credentials/${kind}`,
    );
  }
  /** Needs a device to aim at — a test send with no registered
   *  device is not a test, so the UI asks for one first. */
  pushTest(projectId: string, deviceTokenId: string, title: string, body: string) {
    return this.post<{ sendId?: string; error?: string }>(
      `/admin/api/projects/${projectId}/push/test`,
      { deviceTokenId, title, body },
    );
  }
  pushSends(projectId: string, limit = 50) {
    return this.get<{ sends: PushSend[] }>(
      `/admin/api/projects/${projectId}/push/sends?limit=${limit}`,
    );
  }
  retryPushSend(projectId: string, sendId: string) {
    return this.post<{ status: string }>(
      `/admin/api/projects/${projectId}/push/sends/${sendId}/retry`,
    );
  }
  retryAllFailedPushSends(projectId: string) {
    return this.post<{ requeued: number }>(
      `/admin/api/projects/${projectId}/push/sends/_retry_all_failed`,
    );
  }

  // ── audit (owner) ──
  listAudit(limit = 100) {
    return this.get<{ entries: AuditRow[] }>(`/admin/api/audit?limit=${limit}`);
  }

  // ── attachments (blob fetch) ──
  async fetchAttachmentText(ref: string): Promise<string> {
    const resp = await fetch(`${this.base}/admin/api/attachments/${ref}`, {
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(`attachment ${resp.status}`);
    return resp.text();
  }

  // ── notifications (email channel) ──
  smtpStatus() {
    return this.get<SmtpStatus>('/admin/api/smtp');
  }

  smtpTest() {
    return this.post<{ ok: boolean; to: string }>('/admin/api/smtp/test');
  }

  listNotificationPrefs() {
    return this.get<{ prefs: NotificationPref[] }>('/admin/api/notification-prefs');
  }

  putNotificationPref(pref: {
    projectId: string;
    onNewIssue: boolean;
    onRegression: boolean;
  }) {
    return this.send<{ ok: boolean }>('PUT', '/admin/api/notification-prefs', pref);
  }
}

export const api = new Api();
export { ApiError };
