import { useEffect, useState } from 'react';
import { useT } from '../i18n';
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
  const t = useT();
  const [alerts, setAlerts] = useState<AlertRule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshTok, setRefreshTok] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [throttle, setThrottle] = useState(10);

  async function create() {
    if (!name.trim()) return;
    try {
      await api.createAlert({
        name: name.trim(),
        enabled: true,
        trigger_kind: 'new_issue',
        trigger_config: {},
        filter_config: {},
        channels: {},
        throttle_minutes: throttle,
      });
      setName('');
      setShowCreate(false);
      setRefreshTok(t => t + 1);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    api
      .listAlerts()
      .then(setAlerts)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [refreshTok]);

  async function editChannels(r: AlertRule) {
    const initial = JSON.stringify(r.channels ?? [], null, 2);
    const next = window.prompt(
      'Channels JSON. Example:\n[{"kind":"webhook","url":"https://hooks.slack.com/services/T.../...","secret":"opt"}]',
      initial,
    );
    if (next == null || next === initial) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      setErr('Channels JSON did not parse');
      return;
    }
    try {
      await api.patchAlert(r.id, { channels: parsed });
      setRefreshTok(t => t + 1);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function fireTest(id: string) {
    try {
      const r = await api.fireTestAlert(id);
      const msg =
        r.errors.length > 0
          ? `Delivered ${r.delivered}; errors:\n${r.errors.join('\n')}`
          : `Delivered to ${r.delivered} channel(s).`;
      alert(msg);
    } catch (e) {
      setErr(String(e));
    }
  }

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
    <div>
      <PageHeader
        title={t('alerts.title')}
        subtitle="Workspace-wide rules. Trigger kinds: issue_new / regression / event_count / crash_free_drop."
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'Cancel' : '+ New rule'}
          </Button>
        }
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}

      {showCreate && (
        <Card className="mb-4 px-5 py-4">
          <p className="mb-2 text-xs text-fg-subtle">
            Minimal create — trigger_kind defaults to "issue_new" + filter
            / channels empty. Tune via PATCH /v1/alerts/:id afterward.
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder='Name (e.g. "production new issues")'
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              type="number"
              className="w-24 rounded border border-border-strong bg-surface px-3 py-2 text-sm"
              value={throttle}
              onChange={e =>
                setThrottle(parseInt(e.target.value, 10) || 10)
              }
              title={t('alerts.throttle')}
            />
            <Button onClick={create} size="sm">
              Create
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty={t('alerts.empty')}
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
                  <div className="font-medium text-fg">{r.name}</div>
                  <div className="font-mono text-xs text-fg-subtle">
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
                  <span className="text-xs text-fg-subtle">
                    {formatRelative(r.last_fired_at)}
                  </span>
                ) : (
                  <span className="text-xs text-fg-subtle">never</span>
                ),
            },
            {
              key: 'channels-edit',
              label: '',
              width: '14%',
              render: (r) => (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => editChannels(r)}
                >
                  Channels
                </Button>
              ),
            },
            {
              key: 'fire',
              label: '',
              width: '14%',
              render: (r) => (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fireTest(r.id)}
                >
                  Fire test
                </Button>
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
