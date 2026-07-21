// Single issue detail — meta + matching events tail.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api, EventDetail, EventRow, IssueDetail as Issue } from '../lib/api';
import { EventEvidence } from '../components/crash/EventEvidence';
import { useT } from '../i18n';
import { useKeyHandlers } from '../lib/useShortcuts';
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
  const t = useT();
  const [watchers, setWatchers] = useState<string[]>([]);
  // The latest matching event, loaded in full. This is the crash the
  // page is actually about — the issue row is just its aggregate.
  const [latest, setLatest] = useState<EventDetail | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const myUserId =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('sentori_user_id')
      : null;
  const watching = myUserId ? watchers.includes(myUserId) : false;

  useEffect(() => {
    if (!issueId) return;
    api
      .listWatchers(issueId)
      .then(r => setWatchers(r.watchers.map(w => w.user_id)))
      .catch(() => {});
  }, [issueId]);

  async function toggleWatch() {
    if (!issueId || !myUserId) return;
    try {
      if (watching) {
        await api.unwatchIssue(issueId);
        setWatchers(ws => ws.filter(w => w !== myUserId));
      } else {
        await api.watchIssue(issueId);
        setWatchers(ws => [...ws, myUserId]);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  useKeyHandlers({
    e: () => act('resolved'),
    i: () => act('ignored'),
    r: () => act('active'),
    w: () => toggleWatch(),
  });

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

  // Load the selected event — or the newest one — in full. The list
  // rows carry only identifiers; the payload with the stack,
  // breadcrumbs and context comes from the single-event endpoint.
  useEffect(() => {
    if (!projectId) return;
    const target = selectedEventId ?? events[0]?.id;
    if (!target) return;
    let cancelled = false;
    api
      .getEvent(projectId, target)
      .then(d => {
        if (!cancelled) setLatest(d);
      })
      .catch(e => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, events, selectedEventId]);

  if (!projectId || !issueId) {
    return <ErrorBanner>Missing project/issue id</ErrorBanner>;
  }
  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-fg-subtle">Loading…</div>
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
            {myUserId && (
              <Button
                size="sm"
                variant={watching ? 'primary' : 'secondary'}
                onClick={toggleWatch}
              >
                {watching ? `★ Watching (${watchers.length})` : `☆ Watch (${watchers.length})`}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(issueId);
              }}
            >
              Copy ID
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
              }}
            >
              Copy link
            </Button>
            <Link
              to={`/projects/${projectId}/issues`}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg-subtle hover:bg-raised"
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
                tone={
                  issue.status === 'resolved'
                    ? 'ok'
                    : issue.status === 'regressed'
                      ? 'warn'
                      : 'neutral'
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
                  <span className="font-mono text-[10px] text-fg-subtle ml-1">
                    in {issue.regressed_in_release}
                  </span>
                )}
              </Cell>
            )}
          </div>
        </Section>
      </Card>

      <Comments issueId={issueId} myUserId={myUserId} />
      <Activity issueId={issueId} />

      {latest ? (
        <div className="space-y-8">
          {events.length > 1 && (
            <EventPicker
              events={events}
              selected={latest.id}
              onSelect={setSelectedEventId}
            />
          )}
          <EventEvidence event={latest} projectId={projectId} />
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-fg-subtle">
          {t('crash.noEvent')}
        </p>
      )}
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
      <p className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function Comments({
  issueId,
  myUserId,
}: {
  issueId: string;
  myUserId: string | null;
}) {
  const [rows, setRows] = useState<
    {
      id: string;
      author_user_id: string;
      body_md: string;
      created_at: string;
    }[]
  >([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listComments(issueId)
      .then(r => setRows(r.comments))
      .catch(() => {});
  }, [issueId]);

  async function post() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const c = await api.createComment(issueId, text.trim());
      setRows(rs => [...rs, c]);
      setText('');
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm('Delete comment?')) return;
    try {
      await api.deleteComment(issueId, id);
      setRows(rs => rs.filter(r => r.id !== id));
    } catch {
      /* noop */
    }
  }

  return (
    <Card>
      <CardHeader title={`Comments (${rows.length})`} />
      <Section>
        <div className="space-y-2">
          {rows.map(c => (
            <div
              key={c.id}
              className="rounded border border-border p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-fg-subtle">
                  {c.author_user_id.slice(0, 8)}… ·{' '}
                  {formatRelative(c.created_at)}
                </span>
                {myUserId === c.author_user_id && (
                  <button
                    onClick={() => del(c.id)}
                    className="text-[10px] text-fg-subtle hover:text-red-400"
                  >
                    delete
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-fg">
                {c.body_md}
              </p>
            </div>
          ))}
          {myUserId && (
            <div className="space-y-2 pt-2">
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Add a comment (Markdown)…"
                className="w-full h-20 rounded border border-border p-2 text-xs"
              />
              <Button
                size="sm"
                onClick={post}
                disabled={busy || !text.trim()}
              >
                Post
              </Button>
            </div>
          )}
        </div>
      </Section>
    </Card>
  );
}

function Activity({ issueId }: { issueId: string }) {
  const [rows, setRows] = useState<
    {
      id: string;
      actor_user_id: string | null;
      kind: string;
      created_at: string;
    }[]
  >([]);
  useEffect(() => {
    api
      .listActivity(issueId)
      .then(r => setRows(r.activity))
      .catch(() => {});
  }, [issueId]);

  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title={`Activity (${rows.length})`} />
      <Section>
        <ul className="space-y-1 text-xs">
          {rows.map(a => (
            <li
              key={a.id}
              className="flex items-center justify-between text-fg-muted"
            >
              <span>
                <Badge>{a.kind}</Badge>{' '}
                {a.actor_user_id
                  ? a.actor_user_id.slice(0, 8) + '…'
                  : 'system'}
              </span>
              <span className="font-mono text-[10px]">
                {formatRelative(a.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </Card>
  );
}

/** Which occurrence of this issue you are looking at. Same crash,
 *  different device / build / moment — and those differences are
 *  often the whole diagnosis. */
function EventPicker({
  events,
  selected,
  onSelect,
}: {
  events: EventRow[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {events.slice(0, 12).map(e => {
        const active = e.id === selected;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            aria-current={active}
            className={`rounded border px-2 py-1 font-mono text-[11px] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              active
                ? 'border-accent text-fg'
                : 'border-border text-fg-subtle hover:text-fg-muted'
            }`}
          >
            {formatRelative(e.timestamp)}
            <span className="ml-1.5 text-fg-subtle">{e.platform}</span>
          </button>
        );
      })}
    </div>
  );
}
