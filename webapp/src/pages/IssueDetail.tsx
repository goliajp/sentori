// Issue detail — the interactive rendering of the bundle
// (design.md §11): one vertical narrative, no tabs. Summary →
// stack with in-app frames highlighted → the signal timeline ("what
// the user was doing") → environment → occurrences (collapsed) →
// activity. A sticky action rail on the right carries triage +
// Copy-for-AI + the guard-status card. The narrative order IS the
// design signature.

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useShell } from '../App';
import { KindBadge, RegressedBadge } from '../components/kind';
import { EmptyState, ErrorBanner, formatRelative } from '../components/ui';
import { useT } from '../i18n';
import {
  api,
  type EventDetail,
  type IssueDetail as IssueDetailT,
  type OccurrenceRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Frame = {
  file?: string;
  function?: string;
  line?: number;
  inApp?: boolean;
};

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

  const payload = latest?.payload as
    | { error?: { type?: string; message?: string; stack?: Frame[] }; signals?: Signal[]; device?: Record<string, unknown> }
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
      <div className="mx-auto max-w-3xl px-6 py-8">
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
    return <div className="py-16 text-center text-sm opacity-50">…</div>;
  }

  const project = projects.find((p) => p.id === issue.projectId);
  const surface = issue.surface as { screen?: string; element?: string };

  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-6 py-5">
      {/* ── the narrative ── */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-3 text-xs opacity-50 hover:opacity-100"
        >
          ← {t('issue.back')}
        </button>

        <header className="mb-5">
          <div className="mb-1 flex items-center gap-2">
            <KindBadge kind={issue.kind} />
            {issue.regressedAt && issue.status === 'open' && <RegressedBadge />}
            <span className="text-xs opacity-40">{project?.name}</span>
          </div>
          <h1 className="text-lg font-semibold">{issue.title}</h1>
          {issue.messageSample && (
            <p className="mt-0.5 text-sm opacity-60">{issue.messageSample}</p>
          )}
          <div className="mt-2 font-mono text-xs opacity-60">
            {issue.usersCount}u × {issue.maxPerUser} · {issue.eventCount}ev ·{' '}
            {t('issue.firstSeen')} {formatRelative(issue.firstSeen)} · {t('issue.lastSeen')}{' '}
            {formatRelative(issue.lastSeen)}
            {issue.lastRelease && <> · {issue.lastRelease}</>}
          </div>
          {surface.screen && (
            <div className="mt-1 font-mono text-xs opacity-40">
              {surface.screen}
              {surface.element ? ` · ${surface.element}` : ''}
            </div>
          )}
        </header>

        {payload?.error?.stack && payload.error.stack.length > 0 && (
          <Section title={t('issue.stack')}>
            <div className="overflow-x-auto rounded-md bg-[var(--gds-surface-sunken,#121216)] p-3 font-mono text-xs leading-5">
              {payload.error.stack.slice(0, 40).map((f, i) => (
                <div
                  key={i}
                  className={
                    f.inApp
                      ? 'border-l-2 border-[#ff5d5d] pl-2 text-[var(--gds-text,#e5e5ea)]'
                      : 'pl-2.5 opacity-45'
                  }
                >
                  {f.function ?? '?'}{' '}
                  <span className="opacity-60">
                    ({f.file ?? '?'}
                    {f.line ? `:${f.line}` : ''})
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {payload?.signals && payload.signals.length > 0 && (
          <Section title={t('issue.timeline')}>
            <Timeline signals={payload.signals} />
          </Section>
        )}

        {payload?.device && (
          <Section title={t('issue.environment')}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              {Object.entries(payload.device)
                .filter(([, v]) => typeof v !== 'object')
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 font-mono">
                    <dt className="opacity-50">{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </Section>
        )}

        {occ && occ.events.length > 0 && (
          <Section title={`${t('issue.occurrences')} (${occ.events.length})`} collapsed>
            <div className="divide-y divide-[var(--gds-border,#2a2a30)]">
              {occ.events.map((e) => (
                <OccRow key={e.id} row={e} active={e.id === latestId} />
              ))}
            </div>
          </Section>
        )}

        <Section title={t('issue.activity')}>
          {issue.activity.length === 0 && (
            <EmptyState title={t('issue.noActivity')} hint="" />
          )}
          <ul className="space-y-1.5">
            {issue.activity.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2 text-xs">
                <span className="w-16 shrink-0 font-mono opacity-40">
                  {formatRelative(a.at)}
                </span>
                <span className="rounded bg-[var(--gds-surface-raised,#26262c)] px-1 font-mono text-[10px]">
                  {a.kind}
                </span>
                <span className="opacity-80">
                  {a.actorEmail ?? t('issue.system')} · {summarizeActivity(a.body)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* ── action rail ── */}
      <aside className="w-60 shrink-0">
        <div className="sticky top-5 space-y-3">
          <button
            type="button"
            onClick={copyForAi}
            className="w-full rounded-md bg-[var(--gds-accent,#4c8dff)] px-3 py-1.5 text-sm font-medium text-black"
          >
            {copied ? t('issue.copied') : t('issue.copyForAi')}
          </button>

          {issue.status === 'open' && (
            <div className="rounded-md border border-[var(--gds-border,#2a2a30)] p-3">
              <label className="mb-1 block text-[11px] opacity-60">
                {t('issue.resolveInRelease')}
              </label>
              <input
                value={resolveRelease}
                onChange={(e) => setResolveRelease(e.target.value)}
                placeholder={issue.lastRelease || 'app@x.y.z'}
                className="mb-2 w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(() => api.resolveIssue(issue.id, resolveRelease || undefined))
                }
                className="w-full rounded-md bg-[#4cd97b] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
              >
                {t('issue.resolve')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => api.ignoreIssue(issue.id))}
                className="mt-1.5 w-full rounded-md border border-[var(--gds-border,#2a2a30)] px-3 py-1.5 text-sm opacity-70 hover:opacity-100 disabled:opacity-40"
              >
                {t('issue.ignore')}
              </button>
            </div>
          )}
          {issue.status !== 'open' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.reopenIssue(issue.id))}
              className="w-full rounded-md border border-[var(--gds-border,#2a2a30)] px-3 py-1.5 text-sm"
            >
              {t('issue.reopen')}
            </button>
          )}

          {/* guard status — "fixed" and "verified fixed" are two
              different states, and this card is where that shows */}
          {issue.status === 'resolved' && (
            <div className="rounded-md border border-[#4cd97b40] p-3 text-xs">
              <div className="mb-1 font-semibold text-[#4cd97b]">
                {t('issue.guardTitle')}
              </div>
              <p className="opacity-70">
                {issue.resolvedInRelease
                  ? t('issue.guardAnchored', { release: issue.resolvedInRelease })
                  : t('issue.guardUnanchored')}
              </p>
              <p className="mt-1 opacity-70">{t('issue.guardProbeHint')}</p>
            </div>
          )}

          <div className="rounded-md border border-[var(--gds-border,#2a2a30)] p-3">
            <label className="mb-1 block text-[11px] opacity-60">{t('issue.note')}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mb-2 w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={busy || note.trim().length === 0}
              onClick={() =>
                act(async () => {
                  await api.addNote(issue.id, note.trim());
                  setNote('');
                })
              }
              className="w-full rounded-md border border-[var(--gds-border,#2a2a30)] px-3 py-1 text-xs disabled:opacity-40"
            >
              {t('issue.addNote')}
            </button>
          </div>

          {me.role === 'superadmin' && (
            <AssignBox issue={issue} onDone={reload} />
          )}
        </div>
      </aside>
    </div>
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
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider opacity-50 hover:opacity-80"
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && children}
    </section>
  );
}

/// The signal timeline — a vertical, readable rendering of the last
/// 30 seconds. This is the page's centerpiece; replay frames join it
/// when the wireframe player lands.
function Timeline({ signals }: { signals: Signal[] }) {
  const rows = useMemo(() => [...signals].sort((a, b) => a.t - b.t), [signals]);
  return (
    <ol className="border-l border-[var(--gds-border,#2a2a30)] pl-4">
      {rows.map((s, i) => (
        <li key={i} className="relative mb-1.5 text-xs">
          <span
            className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
            style={{ backgroundColor: signalColor(s.kind) }}
          />
          <span className="mr-2 inline-block w-12 text-right font-mono opacity-40">
            {s.t.toFixed(1)}s
          </span>
          <span className="mr-2 font-mono text-[10px] uppercase opacity-60">{s.kind}</span>
          <span className="font-mono opacity-80">{summarizeSignal(s)}</span>
        </li>
      ))}
      <li className="relative text-xs font-semibold text-[#ff5d5d]">
        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[#ff5d5d]" />
        <span className="mr-2 inline-block w-12 text-right font-mono">0.0s</span>
        <span>●</span>
      </li>
    </ol>
  );
}

function signalColor(kind: string): string {
  switch (kind) {
    case 'nav':
      return '#7fa7c9';
    case 'tap':
      return '#ffb340';
    case 'http':
      return '#b18cff';
    case 'trace':
      return '#4cd97b';
    case 'freeze':
      return '#ff5d5d';
    default:
      return '#8e8e93';
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
      className={`flex items-center gap-3 px-2 py-1.5 font-mono text-xs ${
        active ? 'bg-[var(--gds-surface-raised,#1c1c22)]' : ''
      }`}
    >
      <span className="opacity-40">{formatRelative(row.receivedAt)}</span>
      <span>{row.platform}</span>
      <span className="opacity-60">{row.release}</span>
      <span className="opacity-40">{row.environment}</span>
      {row.userKey && <span className="opacity-30">{row.userKey.slice(0, 8)}</span>}
    </div>
  );
}

function AssignBox({ issue, onDone }: { issue: IssueDetailT; onDone: () => void }) {
  const t = useT();
  const { data } = useAsyncData(() => api.listUsers(), []);
  return (
    <div className="rounded-md border border-[var(--gds-border,#2a2a30)] p-3">
      <label className="mb-1 block text-[11px] opacity-60">{t('issue.assignee')}</label>
      <select
        value={issue.assigneeUserId ?? ''}
        onChange={(e) => {
          void api
            .assignIssue(issue.id, e.target.value === '' ? null : e.target.value)
            .then(onDone);
        }}
        className="w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-xs"
      >
        <option value="">{t('issue.unassigned')}</option>
        {(data?.users ?? []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.email}
          </option>
        ))}
      </select>
    </div>
  );
}

function buildMarkdown(
  issue: IssueDetailT,
  payload:
    | { error?: { type?: string; message?: string; stack?: Frame[] }; signals?: Signal[]; device?: Record<string, unknown> }
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
    lines.push('', '## Stack trace', '```');
    for (const f of payload.error.stack.slice(0, 40)) {
      lines.push(
        `${f.inApp ? '→' : ' '} ${f.function ?? '?'}  (${f.file ?? '?'}${f.line ? `:${f.line}` : ''})`,
      );
    }
    lines.push('```');
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
