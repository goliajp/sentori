import { useEffect, useState } from 'react';
import { api, ApiError, AuditEntry } from '../lib/api';
import {
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAudit({ limit: 200 })
      .then(setEntries)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, []);

  return (
    <div className="p-8">
      <PageHeader
        title="Audit log"
        subtitle="Workspace-wide admin actions, append-only. K13."
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}
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
