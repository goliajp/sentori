import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, EventRow } from '../lib/api';
import {
  Badge,
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function EventsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .listEvents(projectId, { limit: 100 })
      .then(setEvents)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [projectId]);

  if (!projectId) return <div className="p-8">no project id</div>;

  return (
    <div className="p-8">
      <PageHeader
        title="Events"
        subtitle="Recent event tail (newest first, up to 100)."
      />
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
              width: '15%',
              render: (r) => <Badge>{r.environment}</Badge>,
            },
            {
              key: 'issue_id',
              label: 'Issue',
              width: '20%',
              render: (r) => (
                <span className="font-mono text-xs text-zinc-500">
                  {r.issue_id.slice(0, 8)}…
                </span>
              ),
            },
            {
              key: 'timestamp',
              label: 'When',
              width: '15%',
              render: (r) => (
                <span className="text-xs text-zinc-500">
                  {formatRelative(r.timestamp)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
