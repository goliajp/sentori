import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { api, ApiError, EventRow } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorBanner,
  PageHeader,
  Section,
  formatRelative,
} from '../components/ui';

export function EventsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams();
  const issueFilter = search.get('issue_id') ?? '';
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .listEvents(projectId, {
        limit: 100,
        issue_id: issueFilter || undefined,
      })
      .then(setEvents)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [projectId, issueFilter]);

  async function saveView() {
    if (!projectId) return;
    const name = prompt(
      'Saved view name',
      `Events ${issueFilter ? 'for issue ' + issueFilter.slice(0, 8) : 'recent'} — ${new Date().toLocaleDateString()}`,
    );
    if (!name) return;
    try {
      await api.createSavedView({
        name,
        target: 'events',
        scope: 'workspace',
        project_id: projectId,
        payload: issueFilter ? { issue_id: issueFilter } : {},
      });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e) {
      setSaveMsg(String(e).slice(0, 40));
    }
  }

  if (!projectId) return <div className="p-8">no project id</div>;

  return (
    <div className="p-8">
      <PageHeader
        title="Events"
        subtitle="Recent event tail (newest first, up to 100)."
        action={
          <div className="flex items-center gap-2">
            {saveMsg && (
              <span className="font-mono text-xs text-zinc-500">
                {saveMsg}
              </span>
            )}
            <Button onClick={saveView} variant="secondary" size="sm">
              Save filter
            </Button>
          </div>
        }
      />

      {issueFilter && (
        <Card className="mb-4">
          <CardHeader title="Filter" />
          <div className="flex items-center justify-between p-3">
            <span className="font-mono text-xs">
              issue_id ={' '}
              <span className="text-emerald-400">{issueFilter}</span>
            </span>
            <button
              onClick={() => {
                search.delete('issue_id');
                setSearch(search, { replace: true });
              }}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
            >
              Clear ×
            </button>
          </div>
        </Card>
      )}

      {err && <ErrorBanner>{err}</ErrorBanner>}
      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty="No events yet."
          rows={events ?? []}
          columns={[
            {
              key: 'kind',
              label: 'Kind',
              width: '10%',
              render: (r) => <Badge>{r.kind}</Badge>,
            },
            {
              key: 'platform',
              label: 'Plat',
              width: '10%',
              render: (r) => (
                <span className="font-mono text-xs text-zinc-400">
                  {r.platform}
                </span>
              ),
            },
            {
              key: 'release',
              label: 'Release',
              width: '20%',
              render: (r) => (
                <span className="font-mono text-xs text-zinc-400">
                  {r.release}
                </span>
              ),
            },
            {
              key: 'environment',
              label: 'Env',
              width: '12%',
              render: (r) => <Badge>{r.environment}</Badge>,
            },
            {
              key: 'issue_id',
              label: 'Issue',
              width: '20%',
              render: (r) => (
                <Link
                  to={`/projects/${projectId}/issues/${r.issue_id}`}
                  className="font-mono text-xs text-emerald-400 hover:underline"
                >
                  {r.issue_id.slice(0, 8)}…
                </Link>
              ),
            },
            {
              key: 'timestamp',
              label: 'When',
              width: '12%',
              render: (r) => (
                <span className="text-xs text-zinc-500">
                  {formatRelative(r.timestamp)}
                </span>
              ),
            },
            {
              key: 'narrow',
              label: '',
              width: '8%',
              render: (r) => (
                <button
                  onClick={() => {
                    search.set('issue_id', r.issue_id);
                    setSearch(search, { replace: true });
                  }}
                  title="Narrow to this issue"
                  className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                >
                  Narrow
                </button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
