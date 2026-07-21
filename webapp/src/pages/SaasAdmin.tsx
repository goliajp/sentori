// Cross-workspace view — only meaningful in SaaS deployment
// where one sentori-server instance fronts many workspaces.
// In self-hosted mode this just shows the single workspace row.

import { useEffect, useState } from 'react';

import { api, SaasStats, WorkspaceRow } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Section,
  formatNumber,
  formatRelative,
} from '../components/ui';

export default function SaasAdmin() {
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [stats, setStats] = useState<SaasStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  async function refresh() {
    try {
      const [w, s] = await Promise.all([api.listWorkspaces(), api.saasStats()]);
      setRows(w.workspaces);
      setStats(s);
    } catch (e) {
      setError(String(e));
    }
  }

  async function create() {
    if (!name.trim()) return;
    try {
      await api.createWorkspace(name.trim());
      setName('');
      setShowCreate(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  // `busy` keys off the workspace id so only the acting row's
  // buttons disable, not the whole table.
  async function act(w: WorkspaceRow, fn: (id: string) => Promise<void>) {
    setBusy(w.id);
    try {
      await fn(w.id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function destroy(w: WorkspaceRow) {
    if (
      !confirm(
        `Delete workspace "${w.name}"? All projects / events / issues CASCADE-deleted.`,
      )
    )
      return;
    await act(w, id => api.deleteWorkspace(id));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="SaaS admin"
        subtitle="Cross-workspace operator view. In self-hosted mode shows your single workspace."
        actions={
          <Button onClick={() => setShowCreate(true)}>+ New workspace</Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {showCreate && (
        <Card>
          <CardHeader title="Create workspace" />
          <Section>
            <input
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              placeholder="Display name (e.g. 'Acme Inc')"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button onClick={create}>Create</Button>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </Section>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-6 gap-3">
          <StatCard label="Workspaces" value={stats.workspaces} />
          <StatCard
            label="Active"
            value={stats.active_workspaces}
            tone="ok"
          />
          <StatCard label="Projects" value={stats.projects} />
          <StatCard label="Users" value={stats.users} />
          <StatCard
            label="Events 24h"
            value={stats.events_24h ?? 0}
          />
          <StatCard
            label="Tokens"
            value={stats.tokens_active ?? 0}
          />
        </div>
      )}

      <Card>
        <CardHeader title={`Workspaces (${rows.length})`} />
        <Section>
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-500">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No workspaces"
              hint="No workspaces have been provisioned yet."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'name', label: 'Name' },
                { key: 'plan', label: 'Plan' },
                { key: 'status', label: 'Status' },
                { key: 'projects', label: 'Projects' },
                { key: 'members', label: 'Members' },
                { key: 'created', label: 'Created' },
                { key: 'actions', label: '' },
              ]}
              rows={rows.map(w => ({
                key: w.id,
                name: (
                  <div>
                    <div className="font-medium">{w.name}</div>
                    <div className="font-mono text-[10px] text-zinc-400">
                      {w.id}
                    </div>
                  </div>
                ),
                plan: <Badge>{w.plan}</Badge>,
                status:
                  w.status === 'active' ? (
                    <Badge tone="ok">{w.status}</Badge>
                  ) : (
                    <Badge tone="neutral">{w.status}</Badge>
                  ),
                projects: formatNumber(w.project_count),
                members: formatNumber(w.member_count),
                created: formatRelative(w.created_at),
                actions: (
                  <div className="flex items-center gap-1">
                    <select
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200"
                      value={w.plan}
                      disabled={busy === w.id}
                      onChange={e =>
                        act(w, id =>
                          api.saasSetPlan(
                            id,
                            e.target.value as 'free' | 'pro' | 'enterprise',
                          ),
                        )
                      }
                    >
                      <option value="free">free</option>
                      <option value="pro">pro</option>
                      <option value="enterprise">enterprise</option>
                    </select>
                    {w.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === w.id}
                        onClick={() => act(w, id => api.suspendWorkspace(id))}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === w.id}
                        onClick={() => act(w, id => api.resumeWorkspace(id))}
                      >
                        Resume
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy === w.id}
                      onClick={() => destroy(w)}
                    >
                      Delete
                    </Button>
                  </div>
                ),
              }))}
            />
          )}
        </Section>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok';
}) {
  return (
    <Card>
      <div className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <p
          className={`mt-1 text-2xl font-semibold ${tone === 'ok' ? 'text-emerald-600' : 'text-zinc-800'}`}
        >
          {formatNumber(value)}
        </p>
      </div>
    </Card>
  );
}
