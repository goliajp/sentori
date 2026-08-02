// The case file — the right half of the triage split. A pinned
// header answers who/when/on-what in two dense lines; the body is
// a grid of named panels ordered by the human question sequence:
// where it broke → what the user saw → what they were doing → how
// to deal with it (the AI hand-off closes the path). Panels exist
// whether or not their data does — a sparse warn still renders a
// structured case, not a void.

import { useCallback, useState } from 'react';

import { useShell } from '../App';
import { KindBadge, RegressedBadge } from '../components/kind';
import { UserChip } from '../components/identity';
import {
  Button,
  FoldPanel,
  Input,
  Panel,
  PanelEmpty,
  formatRelative,
  formatRelease,
} from '../components/ui';
import { useT } from '../i18n';
import {
  api,
  type EventDetail,
  type IssueDetail as IssueDetailT,
  type OccurrenceRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

import { ReplayPlayer } from '../components/ReplayPlayer';
import { StackTrace, type StackFrame as Frame } from '../components/StackTrace';
import {
  TimelineStrip,
  summarizeSignal,
  type StripContextEvent,
} from '../components/TimelineStrip';
import { WireframePlayer } from '../components/WireframePlayer';

type Signal = { t: number; kind: string; data?: Record<string, unknown> };

export function IssueDetailPane({
  issueId,
  onChanged,
}: {
  issueId: string;
  onChanged?: () => void;
}) {
  const t = useT();
  const { me } = useShell();

  const { data: issue, error, loading, reload } = useAsyncData(
    () => api.getIssue(issueId),
    [issueId],
  );
  const { data: occ } = useAsyncData(() => api.listOccurrences(issueId), [issueId]);
  const latestId = occ?.events[0]?.id;
  const { data: latest } = useAsyncData<EventDetail | null>(
    () => (latestId ? api.getEvent(latestId) : Promise.resolve(null)),
    [latestId],
  );
  const { data: ctx } = useAsyncData(
    () => (latestId ? api.eventContext(latestId) : Promise.resolve({ events: [] })),
    [latestId],
  );

  const [note, setNote] = useState('');
  const [replaySeek, setReplaySeek] = useState<{ t: number; n: number } | null>(null);
  // Frame moments arrive from whichever player loaded; tagged with
  // the event they belong to so switching issues never shows stale
  // ticks (and needs no reset effect).
  const [framesFor, setFramesFor] = useState<{ id: null | string; times: number[] }>({
    id: null,
    times: [],
  });
  const [resolveRelease, setResolveRelease] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      reload();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  // Replay ladder, same-event first, richest form first:
  //   ① this event's pixels  ② this event's wireframe (always-on
  //   capture)  ③ pixels from the newest occurrence that captured
  //   any  ④ the enable hint.
  const screensLatest =
    latest?.attachments?.find((a) => a.kind === 'screens')?.ref ?? null;
  const wireframeLatest =
    latest?.attachments?.find((a) => a.kind === 'replay')?.ref ?? null;
  const screensFallback =
    screensLatest || wireframeLatest
      ? null
      : (occ?.events.find((e) => e.screensRef) ?? null);
  const screensRef = screensLatest ?? screensFallback?.screensRef ?? null;
  const replaySeekable = !!(screensLatest || wireframeLatest);
  const seekReplay = (t: number) =>
    setReplaySeek((prev) => ({ t, n: (prev?.n ?? 0) + 1 }));
  const frameTimes = framesFor.id === latestId ? framesFor.times : [];
  const reportFrames = useCallback(
    (times: number[]) => setFramesFor({ id: latestId ?? null, times }),
    [latestId],
  );
  const eventAtMs = latest ? new Date(latest.occurredAt).getTime() : 0;
  const contextEvents: StripContextEvent[] = (ctx?.events ?? []).map((e) => ({
    id: e.id,
    issueId: e.issueId,
    kind: e.kind,
    name: e.name,
    t: (new Date(e.occurredAt).getTime() - eventAtMs) / 1000,
  }));
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
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-fg-subtle">
          {t('issue.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </p>
      </div>
    );
  }
  if (loading || !issue) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-subtle">
        …
      </div>
    );
  }

  const surface = issue.surface as { screen?: string; element?: string };
  const hasStack = !!payload?.error?.stack && payload.error.stack.length > 0;
  const device = payload?.device;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* ── pinned case header ── */}
      <header className="shrink-0 border-b border-border bg-bg px-5 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <KindBadge kind={issue.kind} />
          {issue.regressedAt && issue.status === 'open' && <RegressedBadge />}
          {surface.screen && (
            <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-fg-muted">
              {surface.screen}
              {surface.element ? ` · ${surface.element}` : ''}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {issue.status === 'open' ? (
              <>
                <Input
                  value={resolveRelease}
                  onChange={(e) => setResolveRelease(e.target.value)}
                  placeholder={
                    issue.lastRelease ? formatRelease(issue.lastRelease) : 'app@x.y.z'
                  }
                  title={t('issue.resolveInRelease')}
                  aria-label={t('issue.resolveInRelease')}
                  className="h-7 w-52 font-mono text-xs"
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
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => api.ignoreIssue(issue.id))}
                >
                  {t('issue.ignore')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act(() => api.reopenIssue(issue.id))}
              >
                {t('issue.reopen')}
              </Button>
            )}
          </span>
        </div>
        <h1 className="mt-1.5 truncate text-[20px] font-semibold tracking-tight">
          {issue.title}
        </h1>
        {issue.messageSample && !issue.title.includes(issue.messageSample) && (
          <p className="mt-0.5 truncate text-sm text-fg-muted">{issue.messageSample}</p>
        )}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-fg-muted">
          <span className="text-fg">
            {issue.usersCount}u × {issue.maxPerUser} · {issue.eventCount}ev
          </span>
          <span>
            {t('issue.firstSeen')} {formatRelative(issue.firstSeen)}
          </span>
          <span>
            {t('issue.lastSeen')} {formatRelative(issue.lastSeen)}
          </span>
          {issue.lastRelease && (
            <span title={issue.lastRelease}>{formatRelease(issue.lastRelease)}</span>
          )}
          {latest && (
            <>
              <span className="text-fg-subtle">·</span>
              <span className="text-fg-subtle">{t('issue.latestCase')}</span>
              {latest.userKey && <UserChip userKey={latest.userKey} />}
              <span>
                {[
                  device?.model,
                  device?.os &&
                    `${String(device.os)} ${String(device.osVersion ?? '')}`.trim(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span>{latest.environment}</span>
            </>
          )}
        </div>
      </header>

      {/* ── the evidence: what the user saw (primary), the code
          (secondary), and the minute itself pinned underneath ── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] xl:overflow-hidden">
          <div className="min-w-0 space-y-4 xl:overflow-y-auto">
            <Panel
              title={t('replay.title')}
              action={
                screensFallback ? (
                  <span className="truncate text-[11px] normal-case tracking-normal text-fg-subtle">
                    {t('issue.replayFrom', {
                      when: formatRelative(screensFallback.occurredAt),
                    })}
                  </span>
                ) : !screensRef && wireframeLatest ? (
                  <span className="text-[11px] normal-case tracking-normal text-fg-subtle">
                    wireframe
                  </span>
                ) : undefined
              }
            >
              {screensRef ? (
                <ReplayPlayer
                  attachmentRef={screensRef}
                  seek={replaySeek}
                  onFrames={screensLatest ? reportFrames : undefined}
                />
              ) : wireframeLatest ? (
                <div>
                  <WireframePlayer
                    attachmentRef={wireframeLatest}
                    seek={replaySeek}
                    onFrames={reportFrames}
                  />
                  <p className="border-t border-border px-3.5 py-2 text-xs text-fg-subtle">
                    {t('issue.replayWireframe')}
                  </p>
                </div>
              ) : (
                <PanelEmpty>{t('issue.replayNone')}</PanelEmpty>
              )}
            </Panel>

            <Panel title={t('issue.handoff')}>
              <div className="space-y-2.5 p-3.5">
                <p className="text-[13px] text-fg-muted">{t('issue.handoffHint')}</p>
                <Button variant="primary" onClick={() => void copyForAi()}>
                  {copied ? t('issue.copied') : t('issue.copyForAi')}
                </Button>
              </div>
            </Panel>

            {issue.status === 'resolved' && (
              <Panel title={<span className="text-ok">{t('issue.guardTitle')}</span>}>
                <div className="space-y-1 p-3.5 text-[13px] text-fg-muted">
                  <p>
                    {issue.resolvedInRelease
                      ? t('issue.guardAnchored', { release: issue.resolvedInRelease })
                      : t('issue.guardUnanchored')}
                  </p>
                  <p>{t('issue.guardProbeHint')}</p>
                </div>
              </Panel>
            )}
          </div>

          <div className="min-w-0 space-y-4 xl:overflow-y-auto">
            {hasStack && (
              <Panel title={t('issue.code')}>
                <StackTrace frames={payload!.error!.stack!} />
              </Panel>
            )}

            {occ && occ.events.length > 0 && (
              <FoldPanel title={`${t('issue.occurrences')} (${occ.events.length})`}>
                <div className="divide-y divide-border/60">
                  {occ.events.map((e) => (
                    <OccRow key={e.id} row={e} active={e.id === latestId} />
                  ))}
                </div>
              </FoldPanel>
            )}
            {device && (
              <FoldPanel title={t('issue.environment')}>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 p-4 font-mono text-[13px] sm:grid-cols-3">
                  {Object.entries(device)
                    .filter(([, v]) => typeof v !== 'object')
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-fg-subtle">{k}</dt>
                        <dd className="truncate text-fg-muted">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </FoldPanel>
            )}
            <FoldPanel
              title={`${t('issue.activity')}${issue.activity.length ? ` (${issue.activity.length})` : ''}`}
            >
              <div className="p-4">
                {issue.activity.length === 0 && (
                  <p className="pb-2 text-sm text-fg-subtle">{t('issue.noActivity')}</p>
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
                  {me.role === 'superadmin' && (
                    <AssignSelect issue={issue} onDone={reload} />
                  )}
                </div>
              </div>
            </FoldPanel>
          </div>
        </div>
      </div>

      {/* ── the minute itself: the case's narrative spine ── */}
      <TimelineStrip
        signals={(payload?.signals ?? []) as { t: number; kind: string; data?: Record<string, unknown> }[]}
        frameTimes={frameTimes}
        context={contextEvents}
        issueKind={issue.kind}
        onSeek={replaySeekable ? seekReplay : undefined}
      />
    </div>
  );
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
      <span className="text-fg-muted" title={row.release}>
        {formatRelease(row.release)}
      </span>
      <span className="text-fg-subtle">{row.environment}</span>
      {row.userKey && (
        <span className="text-fg-subtle">
          <UserChip userKey={row.userKey} />
        </span>
      )}
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
