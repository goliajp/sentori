import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, IngestRequest, Issue } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  Tabs,
  formatNumber,
  formatRelative,
} from '../components/ui';

const STATUS_TONE: Record<Issue['status'], 'ok' | 'warn' | 'danger' | 'neutral'> = {
  active: 'danger',
  regressed: 'warn',
  resolved: 'ok',
  ignored: 'neutral',
};

export function IssuesPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams();
  const statusFilter = search.get('status') ?? '';
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .listIssues(projectId, { status: statusFilter || undefined })
      .then(setIssues)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [projectId, statusFilter]);

  if (!projectId) return <div className="p-8">no project id</div>;

  return (
    <div className="p-8">
      <PageHeader
        title="Issues"
        subtitle={`Project ${projectId.slice(0, 8)}…`}
        action={<TestIngestButton projectId={projectId} />}
      />

      <div className="mb-4">
        <Tabs
          value={statusFilter || 'all'}
          onChange={(v) => {
            if (v === 'all') {
              search.delete('status');
            } else {
              search.set('status', v);
            }
            setSearch(search, { replace: true });
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'regressed', label: 'Regressed' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'ignored', label: 'Ignored' },
          ]}
        />
      </div>

      {err && <ErrorBanner>{err}</ErrorBanner>}

      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty="No issues. Send some events with the SDK to populate."
          rows={issues ?? []}
          columns={[
            {
              key: 'status',
              label: '',
              width: '5%',
              render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
            },
            {
              key: 'error_type',
              label: 'Issue',
              render: (r) => (
                <Link
                  to={`/projects/${projectId}/issues/${r.id}`}
                  className="block hover:bg-zinc-900/40 -m-2 p-2 rounded"
                >
                  <div className="font-medium text-zinc-100">{r.error_type}</div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {r.message_sample.slice(0, 80)}
                  </div>
                </Link>
              ),
            },
            {
              key: 'event_count',
              label: 'Events',
              width: '10%',
              render: (r) => (
                <span className="font-mono tabular-nums">
                  {formatNumber(r.event_count)}
                </span>
              ),
            },
            {
              key: 'last_release',
              label: 'Release',
              width: '15%',
              render: (r) => (
                <span className="font-mono text-xs text-zinc-400">
                  {r.last_release}
                </span>
              ),
            },
            {
              key: 'last_environment',
              label: 'Env',
              width: '10%',
              render: (r) => <Badge>{r.last_environment}</Badge>,
            },
            {
              key: 'last_seen',
              label: 'Last seen',
              width: '15%',
              render: (r) => (
                <span className="text-xs text-zinc-500">
                  {formatRelative(r.last_seen)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

function TestIngestButton({ projectId }: { projectId: string }) {
  const [sending, setSending] = useState(false);
  const [out, setOut] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setOut(null);
    const body: IngestRequest = {
      kind: 'error',
      error_type: 'TypeError',
      message: 'x is undefined (test ingest)',
      platform: 'javascript',
      release: 'webapp@0.1.0',
      environment: 'development',
    };
    try {
      const r = await api.ingestEvent(projectId, body);
      setOut(`${r.is_new ? 'new' : 'existing'}: ${r.issue_id.slice(0, 8)}`);
    } catch (e) {
      setOut(`error: ${String(e)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {out && (
        <span className="font-mono text-xs text-zinc-500">{out}</span>
      )}
      <Button onClick={send} disabled={sending} variant="primary" size="sm">
        {sending ? 'Sending…' : 'Test ingest'}
      </Button>
    </div>
  );
}
