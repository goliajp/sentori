// Single issue detail — meta + matching events tail.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api, EventRow, IssueDetail as Issue } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorBanner,
  PageHeader,
  Section,
  formatNumber,
  formatRelative,
} from '../components/ui';

export default function IssueDetail() {
  const { id: projectId, issueId } = useParams<{
    id: string;
    issueId: string;
  }>();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(status: 'active' | 'resolved' | 'ignored') {
    if (!projectId || !issueId) return;
    setBusy(true);
    try {
      await api.patchIssue(projectId, issueId, { status });
      const next = await api.getIssue(projectId, issueId);
      setIssue(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!projectId || !issueId) return;
    Promise.all([
      api.getIssue(projectId, issueId),
      api.listEvents(projectId, { issue_id: issueId, limit: 50 }),
    ])
      .then(([i, e]) => {
        setIssue(i);
        setEvents(e);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId, issueId]);

  if (!projectId || !issueId) {
    return <ErrorBanner>Missing project/issue id</ErrorBanner>;
  }
  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>
    );
  }
  if (error) {
    return <ErrorBanner>{error}</ErrorBanner>;
  }
  if (!issue) {
    return <ErrorBanner>Issue not found</ErrorBanner>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={issue.error_type}
        subtitle={issue.message_sample}
        actions={
          <div className="flex items-center gap-2">
            {issue.status !== 'resolved' && (
              <Button
                size="sm"
                onClick={() => act('resolved')}
                disabled={busy}
              >
                Resolve
              </Button>
            )}
            {issue.status !== 'ignored' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act('ignored')}
                disabled={busy}
              >
                Ignore
              </Button>
            )}
            {issue.status !== 'active' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act('active')}
                disabled={busy}
              >
                Reopen
              </Button>
            )}
            <Link
              to={`/projects/${projectId}/issues`}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              ← All
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader title="Meta" />
        <Section>
          <div className="grid grid-cols-4 gap-4">
            <Cell label="Status">
              <Badge
                variant={
                  issue.status === 'resolved'
                    ? 'ok'
                    : issue.status === 'regressed'
                      ? 'muted'
                      : 'default'
                }
              >
                {issue.status}
              </Badge>
            </Cell>
            <Cell label="Kind">
              <span className="font-mono text-xs">{issue.kind}</span>
            </Cell>
            <Cell label="Events">{formatNumber(issue.event_count)}</Cell>
            <Cell label="Last release">
              <span className="font-mono text-xs">
                {issue.last_release || '—'}
              </span>
            </Cell>
            <Cell label="First seen">{formatRelative(issue.first_seen)}</Cell>
            <Cell label="Last seen">{formatRelative(issue.last_seen)}</Cell>
            <Cell label="Environment">
              <span className="font-mono text-xs">{issue.last_environment || '—'}</span>
            </Cell>
            <Cell label="Fingerprint">
              <span className="font-mono text-[10px] break-all">
                {issue.fingerprint.slice(0, 16)}…
              </span>
            </Cell>
            {issue.resolved_at && (
              <Cell label="Resolved at">
                {formatRelative(issue.resolved_at)}
              </Cell>
            )}
            {issue.regressed_at && (
              <Cell label="Regressed at">
                {formatRelative(issue.regressed_at)}
                {issue.regressed_in_release && (
                  <span className="font-mono text-[10px] text-zinc-500 ml-1">
                    in {issue.regressed_in_release}
                  </span>
                )}
              </Cell>
            )}
          </div>
        </Section>
      </Card>

      <Card>
        <CardHeader title={`Recent events (${events.length})`} />
        <Section>
          {events.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              No matching events.
            </div>
          ) : (
            <div className="space-y-1">
              {events.map(e => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded border border-zinc-200 p-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Badge>{e.kind}</Badge>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {e.platform}
                    </span>
                    <span className="text-zinc-400">/</span>
                    <span className="font-mono text-[10px]">{e.release}</span>
                    <span className="text-zinc-400">/</span>
                    <span className="font-mono text-[10px]">
                      {e.environment}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {formatRelative(e.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </Card>
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
