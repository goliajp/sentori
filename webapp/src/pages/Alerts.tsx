import { useEffect, useState } from 'react';
import { api, AlertRule, ApiError } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshTok, setRefreshTok] = useState(0);

  useEffect(() => {
    api
      .listAlerts()
      .then(setAlerts)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [refreshTok]);

  async function deleteAlert(id: string) {
    if (!confirm('Delete this alert rule?')) return;
    try {
      await api.deleteAlert(id);
      setRefreshTok((t) => t + 1);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Alert rules"
        subtitle="Workspace-wide rules. K14 backend: new_issue / regression / event_count / crash_free_drop."
        action={
          <Button variant="primary" size="sm" onClick={() => alert('New alert form lands in v0.1.x')}>
            + New rule
          </Button>
        }
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty="No alert rules. Create one to start receiving notifications."
          rows={alerts ?? []}
          columns={[
            {
              key: 'enabled',
              label: 'On',
              width: '5%',
              render: (r) => (
                <Badge tone={r.enabled && !r.muted ? 'ok' : 'neutral'}>
                  {r.muted ? 'muted' : r.enabled ? 'on' : 'off'}
                </Badge>
              ),
            },
            {
              key: 'name',
              label: 'Name',
              render: (r) => (
                <div>
                  <div className="font-medium text-zinc-100">{r.name}</div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {r.trigger_kind} · throttle {r.throttle_minutes}m
                    {r.project_id ? ` · project ${r.project_id.slice(0, 8)}` : ' · workspace-wide'}
                  </div>
                </div>
              ),
            },
            {
              key: 'last_fired_at',
              label: 'Last fired',
              width: '15%',
              render: (r) =>
                r.last_fired_at ? (
                  <span className="text-xs text-zinc-500">
                    {formatRelative(r.last_fired_at)}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">never</span>
                ),
            },
            {
              key: 'id',
              label: '',
              width: '10%',
              render: (r) => (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => deleteAlert(r.id)}
                >
                  Delete
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
