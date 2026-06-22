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

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      credentials: 'include',
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return (await r.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
    const r = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
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
