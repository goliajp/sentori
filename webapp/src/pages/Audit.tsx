import { useEffect, useState } from 'react';
import { api, ApiError, AuditEntry } from '../lib/api';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(200);

  async function load() {
    try {
      const r = await api.listAudit({
        project_id: projectId.trim() || undefined,
        actor_user_id: actor.trim() || undefined,
        action: action.trim() || undefined,
        limit,
      });
      setEntries(r);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
      else setErr(String(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clear() {
    setProjectId('');
    setActor('');
    setAction('');
    setLimit(200);
    // Reload with cleared filters after state flush
    setTimeout(load, 0);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Audit log"
        subtitle="Workspace-wide admin actions, append-only."
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}

      <Card className="mb-4">
        <CardHeader title="Filter" />
        <div className="grid grid-cols-4 gap-2 p-4">
          <Field
            label="Project ID"
            value={projectId}
            onChange={setProjectId}
            placeholder="UUID (optional)"
          />
          <Field
            label="Actor user ID"
            value={actor}
            onChange={setActor}
            placeholder="UUID (optional)"
          />
          <Field
            label="Action"
            value={action}
            onChange={setAction}
            placeholder="e.g. project.create"
          />
          <Field
            label="Limit"
            value={String(limit)}
            onChange={v => setLimit(parseInt(v, 10) || 200)}
            placeholder="200"
          />
          <div className="col-span-4 flex gap-2">
            <Button onClick={load}>Apply</Button>
            <Button variant="secondary" onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty="No audit entries yet."
          rows={entries ?? []}
          columns={[
            {
              key: 'action',
              label: 'Action',
              render: (r) => (
                <div>
                  <div className="font-mono text-sm text-zinc-100">{r.action}</div>
                  {(r.target_type || r.target_id) && (
                    <div className="font-mono text-[11px] text-zinc-500">
                      {r.target_type ?? ''} {r.target_id ?? ''}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'actor_user_id',
              label: 'Actor',
              width: '20%',
              render: (r) =>
                r.actor_user_id ? (
                  <span className="font-mono text-xs text-zinc-400">
                    {r.actor_user_id.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">system</span>
                ),
            },
            {
              key: 'project_id',
              label: 'Project',
              width: '15%',
              render: (r) =>
                r.project_id ? (
                  <span className="font-mono text-xs text-zinc-400">
                    {r.project_id.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-xs text-zinc-600">workspace</span>
                ),
            },
            {
              key: 'created_at',
              label: 'When',
              width: '15%',
              render: (r) => (
                <span className="text-xs text-zinc-500">
                  {formatRelative(r.created_at)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-mono focus:border-brand-500 focus:outline-none"
      />
    </div>
  );
}
