// Issue detail — the interactive rendering of the bundle
// (design.md §11): one narrative, no tabs, ordered by what a human
// asks first when something broke on a phone:
//
//   ① where it broke      — the failing line, source window open
//   ② what the user saw   — replay dock in a square viewport
//   ③ what they were doing — the signal timeline
//
// The replay lives in a right-hand column: the dock beside the code
// reads like holding the user's phone next to the stack trace. Its
// viewport is square so portrait and landscape frames both
// letterbox gracefully. Everything else — triage,
// occurrences, raw environment, activity — is obligation, not
// desire: triage compresses into the header toolbar, the rest folds
// into corner rows at the bottom. (The UX iron rule: give what they
// came for in full, hide what they didn't, corner the obligatory.)

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useShell } from '../App';
import { KindBadge, RegressedBadge, kindColor } from '../components/kind';
import { Button, EmptyState, ErrorBanner, Input, formatRelative } from '../components/ui';
import { useT } from '../i18n';
import {
  api,
  type EventDetail,
  type IssueDetail as IssueDetailT,
  type OccurrenceRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

import { ReplayPlayer } from '../components/ReplayPlayer';
import { WireframePlayer } from '../components/WireframePlayer';
import { StackTrace, type StackFrame as Frame } from '../components/StackTrace';

type Signal = { t: number; kind: string; data?: Record<string, unknown> };

export default function IssueDetail() {
  const t = useT();
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const { me, projects } = useShell();

  const { data: issue, error, loading, reload } = useAsyncData(
    () => api.getIssue(issueId ?? ''),
    [issueId],
  );
  const { data: occ } = useAsyncData(() => api.listOccurrences(issueId ?? ''), [issueId]);
  const latestId = occ?.events[0]?.id;
  const { data: latest } = useAsyncData<EventDetail | null>(
    () => (latestId ? api.getEvent(latestId) : Promise.resolve(null)),
    [latestId],
  );

  const [note, setNote] = useState('');
  const [resolveRelease, setResolveRelease] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } finally {
      setBusy(false);
    }
  };

  // Replay ladder, same-event first, richest form first:
  //   ① this event's pixels  ② this event's wireframe (always-on
  //   capture — every SDK event has one even when replayScreens is
  //   off)  ③ pixels from the newest occurrence that captured any
  //   (an older-SDK event on top must not hide an existing replay).
  const screensLatest =
    latest?.attachments?.find((a) => a.kind === 'screens')?.ref ?? null;
  const wireframeLatest =
    latest?.attachments?.find((a) => a.kind === 'replay')?.ref ?? null;
  const screensFallback =
    screensLatest || wireframeLatest
      ? null
      : (occ?.events.find((e) => e.screensRef) ?? null);
  const screensRef = screensLatest ?? screensFallback?.screensRef ?? null;
  const payload = latest?.payload as
    | {
        error?: { type?: string; message?: string; stack?: Frame[] };
        signals?: Signal[];
        device?: Record<string, unknown>;
      }
    | undefined;

  const copyForAi = async () => {
    if (!issue) return;
    // The AI-ready shape without an api token: assemble from what
    // the page already loaded. (The /api bundle needs a bearer; the
    // dashboard's copy carries the same evidence.)
    const md = buildMarkdown(issue, payload, occ?.events ?? []);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-7 py-8">
        <ErrorBanner>
          {t('issue.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </ErrorBanner>
      </div>
    );
  }
  if (loading || !issue) {
    return <div className="py-16 text-center text-sm text-fg-subtle">…</div>;
  }

  const project = projects.find((p) => p.id === issue.projectId);
  const surface = issue.surface as { screen?: string; element?: string };
  const hasStack = !!payload?.error?.stack && payload.error.stack.length > 0;
  const device = payload?.device;

  return (
    <div className="mx-auto max-w-[1760px] px-7 py-5">
      {/* ── header: identity left, triage right ── */}
      <header className="mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-2 text-sm text-fg-subtle hover:text-fg"
        >
          ← {t('issue.back')}
        </button>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <KindBadge kind={issue.kind} />
            {issue.regressedAt && issue.status === 'open' && <RegressedBadge />}
            <span className="text-sm text-fg-subtle">{project?.name}</span>
            {surface.screen && (
              <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-fg-muted">
                {surface.screen}
                {surface.element ? ` · ${surface.element}` : ''}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{issue.title}</h1>
          {issue.messageSample && (
            <p className="mt-1 text-[15px] text-fg-muted">{issue.messageSample}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[13px] tabular-nums text-fg-muted">
            <span className="text-fg">
              {issue.usersCount}u × {issue.maxPerUser} · {issue.eventCount}ev
            </span>
            <span>
              {t('issue.firstSeen')} {formatRelative(issue.firstSeen)}
            </span>
            <span>
              {t('issue.lastSeen')} {formatRelative(issue.lastSeen)}
            </span>
            {issue.lastRelease && <span>{issue.lastRelease}</span>}
          </div>
          {/* who / when / on what — the latest case, one line. The
              narrative's opening facts, not a folded appendix. */}
          {latest && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[13px] text-fg-muted">
              <span className="text-fg-subtle">{t('issue.latestCase')}</span>
              {latest.userKey && (
                <span className="text-fg" title={latest.userKey}>
                  {latest.userKey.length > 16
                    ? `${latest.userKey.slice(0, 16)}…`
                    : latest.userKey}
                </span>
              )}
              <span>{formatRelative(latest.occurredAt)}</span>
              <span>
                {[device?.model, device?.os && `${String(device.os)} ${String(device.osVersion ?? '')}`.trim()]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {device?.appVersion !== undefined && <span>app {String(device.appVersion)}</span>}
              <span>{latest.environment}</span>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-7 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── the narrative ── */}
        <div className="min-w-0">
          {hasStack && (
            <Section title={t('issue.code')}>
              <StackTrace frames={payload!.error!.stack!} />
            </Section>
          )}

          {payload?.signals && payload.signals.length > 0 && (
            <Section title={t('issue.timeline')}>
              <Timeline signals={payload.signals} kind={issue.kind} />
            </Section>
          )}

          {/* corner rows: obligatory, folded */}
          {occ && occ.events.length > 0 && (
            <Section title={`${t('issue.occurrences')} (${occ.events.length})`} collapsed>
              <div className="divide-y divide-border rounded-md border border-border bg-surface">
                {occ.events.map((e) => (
                  <OccRow key={e.id} row={e} active={e.id === latestId} />
                ))}
              </div>
            </Section>
          )}

          {payload?.device && (
            <Section title={t('issue.environment')} collapsed>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 rounded-md border border-border bg-surface p-4 font-mono text-[13px] sm:grid-cols-3">
                {Object.entries(payload.device)
                  .filter(([, v]) => typeof v !== 'object')
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-fg-subtle">{k}</dt>
                      <dd className="truncate text-fg-muted">{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </Section>
          )}

          <Section
            title={`${t('issue.activity')}${issue.activity.length ? ` (${issue.activity.length})` : ''}`}
            collapsed={issue.activity.length === 0}
          >
            {issue.activity.length === 0 && (
              <EmptyState title={t('issue.noActivity')} hint="" />
            )}
            <ul className="space-y-2">
              {issue.activity.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2.5 text-[13px]">
                  <span className="w-16 shrink-0 font-mono text-fg-subtle">
                    {formatRelative(a.at)}
                  </span>
                  <span className="rounded bg-raised px-1.5 font-mono text-xs text-fg-muted">
                    {a.kind}
                  </span>
                  <span className="text-fg-muted">
                    {a.actorEmail ?? t('issue.system')} · {summarizeActivity(a.body)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('issue.note')}
                aria-label={t('issue.note')}
                className="min-w-0 max-w-96 flex-1 text-sm"
              />
              <Button
                size="sm"
                disabled={busy || note.trim().length === 0}
                onClick={() =>
                  void act(async () => {
                    await api.addNote(issue.id, note.trim());
                    setNote('');
                  })
                }
              >
                {t('issue.addNote')}
              </Button>
              {me.role === 'superadmin' && <AssignSelect issue={issue} onDone={reload} />}
            </div>
          </Section>
        </div>

        {/* ── the phone: what the user saw + the quiet obligations ── */}
        <aside className="min-w-0">
          <div className="sticky top-5 space-y-4">
            <SectionLabel>{t('replay.title')}</SectionLabel>
            {screensRef ? (
              <div>
                <ReplayPlayer attachmentRef={screensRef} />
                {screensFallback && (
                  <p className="mt-1.5 text-xs text-fg-subtle">
                    {t('issue.replayFrom', {
                      when: formatRelative(screensFallback.occurredAt),
                    })}
                  </p>
                )}
              </div>
            ) : wireframeLatest ? (
              <div>
                <WireframePlayer attachmentRef={wireframeLatest} />
                <p className="mt-1.5 text-xs text-fg-subtle">
                  {t('issue.replayWireframe')}
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-fg-subtle">
                {t('issue.replayNone')}
              </p>
            )}

            {/* the narrative's last stop: what to do about it. The
                AI copy is the primary exit — it carries the code,
                the journey and the environment in one paste. */}
            <div className="rounded-md border border-accent/40 bg-surface p-3.5">
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">
                {t('issue.handoff')}
              </div>
              <p className="mb-3 text-sm text-fg-muted">{t('issue.handoffHint')}</p>
              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={() => void copyForAi()}>
                  {copied ? t('issue.copied') : t('issue.copyForAi')}
                </Button>
                {issue.status === 'open' ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={resolveRelease}
                      onChange={(e) => setResolveRelease(e.target.value)}
                      placeholder={issue.lastRelease || 'app@x.y.z'}
                      title={t('issue.resolveInRelease')}
                      aria-label={t('issue.resolveInRelease')}
                      className="min-w-0 flex-1 font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api.resolveIssue(issue.id, resolveRelease || undefined))
                      }
                    >
                      {t('issue.resolve')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void act(() => api.ignoreIssue(issue.id))}
                    >
                      {t('issue.ignore')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => void act(() => api.reopenIssue(issue.id))}
                  >
                    {t('issue.reopen')}
                  </Button>
                )}
              </div>
            </div>

            {/* guard status — "fixed" and "verified fixed" are two
                different states, and this card is where that shows */}
            {issue.status === 'resolved' && (
              <div className="rounded-md border border-ok/40 bg-surface p-3.5 text-sm">
                <div className="mb-1 font-semibold text-ok">{t('issue.guardTitle')}</div>
                <p className="text-fg-muted">
                  {issue.resolvedInRelease
                    ? t('issue.guardAnchored', { release: issue.resolvedInRelease })
                    : t('issue.guardUnanchored')}
                </p>
                <p className="mt-1 text-fg-muted">{t('issue.guardProbeHint')}</p>
              </div>
            )}

          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">
      {children}
    </h3>
  );
}

function Section({
  title,
  collapsed,
  children,
}: {
  title: string;
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="mb-7">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle hover:text-fg-muted"
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && children}
    </section>
  );
}

/// The signal timeline — a readable rendering of the last 30
/// seconds, ending on the moment the event fired.
function Timeline({
  signals,
  kind,
}: {
  signals: Signal[];
  kind: IssueDetailT['kind'];
}) {
  const t = useT();
  const rows = useMemo(() => [...signals].sort((a, b) => a.t - b.t), [signals]);
  return (
    <ol className="ml-1.5 border-l border-border pl-5">
      {rows.map((s, i) => (
        <li key={i} className="relative mb-2 text-[13px]">
          <span
            className="absolute -left-[25px] top-[5px] h-2 w-2 rounded-full"
            style={{ backgroundColor: signalColor(s.kind) }}
          />
          <span className="mr-2.5 inline-block w-12 text-right font-mono tabular-nums text-fg-subtle">
            {s.t.toFixed(1)}s
          </span>
          <span
            className="mr-2.5 font-mono text-[11px] uppercase tracking-wide"
            style={{ color: signalColor(s.kind) }}
          >
            {s.kind}
          </span>
          <span className="font-mono text-fg-muted">{summarizeSignal(s)}</span>
        </li>
      ))}
      <li className="relative text-[13px] font-semibold" style={{ color: kindColor(kind) }}>
        <span
          className="absolute -left-[26px] top-[4px] h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: kindColor(kind) }}
        />
        <span className="mr-2.5 inline-block w-12 text-right font-mono tabular-nums">0.0s</span>
        <span>{t('issue.eventMoment', { kind })}</span>
      </li>
    </ol>
  );
}

/** Timeline hues borrow the five kind hues so the palette keeps one
 *  concept model: nav reads calm, freeze reads like the error it
 *  usually precedes. */
function signalColor(kind: string): string {
  switch (kind) {
    case 'nav':
      return 'var(--s-kind-trace)';
    case 'tap':
      return 'var(--s-kind-warn)';
    case 'http':
      return 'var(--s-kind-assert)';
    case 'trace':
      return 'var(--s-kind-probe)';
    case 'freeze':
      return 'var(--s-kind-error)';
    default:
      return 'var(--gds-fg-muted)';
  }
}

function summarizeSignal(s: Signal): string {
  const d = s.data ?? {};
  const parts = Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.join(' ');
}

function summarizeActivity(body: Record<string, unknown>): string {
  if (typeof body.text === 'string') return body.text;
  if (typeof body.to === 'string') {
    return body.inRelease ? `→ ${body.to} (${String(body.inRelease)})` : `→ ${body.to}`;
  }
  if (typeof body.in_release === 'string') return `↩ ${String(body.in_release)}`;
  return JSON.stringify(body);
}

function OccRow({ row, active }: { row: OccurrenceRow; active: boolean }) {
  return (
    <div
      className={`flex items-center gap-4 px-3.5 py-2 font-mono text-[13px] ${
        active ? 'bg-raised' : ''
      }`}
    >
      <span className="text-fg-subtle">{formatRelative(row.receivedAt)}</span>
      <span className="text-fg">{row.platform}</span>
      <span className="text-fg-muted">{row.release}</span>
      <span className="text-fg-subtle">{row.environment}</span>
      {row.userKey && <span className="text-fg-subtle/70">{row.userKey.slice(0, 8)}</span>}
    </div>
  );
}

function AssignSelect({ issue, onDone }: { issue: IssueDetailT; onDone: () => void }) {
  const t = useT();
  const { data } = useAsyncData(() => api.listUsers(), []);
  return (
    <select
      value={issue.assigneeUserId ?? ''}
      aria-label={t('issue.assignee')}
      onChange={(e) => {
        void api
          .assignIssue(issue.id, e.target.value === '' ? null : e.target.value)
          .then(onDone);
      }}
      className="h-7 min-w-0 max-w-40 rounded border border-border bg-surface px-1.5 text-xs text-fg-muted"
    >
      <option value="">{t('issue.unassigned')}</option>
      {(data?.users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.email}
        </option>
      ))}
    </select>
  );
}

function buildMarkdown(
  issue: IssueDetailT,
  payload:
    | {
        error?: { type?: string; message?: string; stack?: Frame[] };
        signals?: Signal[];
        device?: Record<string, unknown>;
      }
    | undefined,
  occ: OccurrenceRow[],
): string {
  const lines: string[] = [];
  lines.push(`# ${issue.kind}: ${issue.title}`);
  if (issue.messageSample) lines.push(`> ${issue.messageSample}`);
  lines.push('');
  lines.push(
    `- Status: ${issue.status}${issue.regressedInRelease ? ` (REGRESSED in ${issue.regressedInRelease})` : ''}`,
  );
  lines.push(
    `- Impact: ${issue.usersCount} users × up to ${issue.maxPerUser} · ${issue.eventCount} events`,
  );
  lines.push(`- Last release: ${issue.lastRelease || 'unknown'}`);
  if (payload?.error?.stack) {
    // (frame list first, source windows after — same shape as the
    // server-side bundle)
    lines.push('', '## Stack trace', '```');
    for (const f of payload.error.stack.slice(0, 40)) {
      lines.push(
        `${f.inApp ? '→' : ' '} ${f.function ?? '?'}  (${f.file ?? '?'}${f.line ? `:${f.line}` : ''})`,
      );
    }
    lines.push('```');
    // Source windows for the top in-app frames, so the AI reads the
    // failing code straight out of the paste.
    let shown = 0;
    for (const f of payload.error.stack) {
      if (shown >= 3) break;
      if (!f.inApp || typeof f.contextLine !== 'string') continue;
      const pre = f.preContext ?? [];
      const post = f.postContext ?? [];
      const hit = f.line ?? 0;
      lines.push('', `### ${f.function ?? '?'} — ${f.file ?? '?'}:${hit}`, '```');
      pre.forEach((l, i) => lines.push(`  ${String(hit - pre.length + i).padStart(4)} | ${l}`));
      lines.push(`> ${String(hit).padStart(4)} | ${f.contextLine}`);
      post.forEach((l, i) => lines.push(`  ${String(hit + 1 + i).padStart(4)} | ${l}`));
      lines.push('```');
      shown += 1;
    }
  }
  if (payload?.signals?.length) {
    lines.push('', '## What the user was doing');
    for (const s of payload.signals) {
      lines.push(`- ${s.t.toFixed(1)}s [${s.kind}] ${summarizeSignal(s)}`);
    }
  }
  if (occ.length) {
    lines.push('', `## Occurrences (${occ.length} recent)`);
    for (const e of occ.slice(0, 10)) {
      lines.push(`- ${e.receivedAt} ${e.platform} ${e.release}`);
    }
  }
  lines.push(
    '',
    '---',
    `When fixed: plant sentori.probe('<ref>') in the broken branch, note it here, and resolve anchored on the fixing release.`,
  );
  return lines.join('\n');
}
