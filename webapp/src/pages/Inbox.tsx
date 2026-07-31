// Inbox — the default page, answering one question: what should I
// handle now? (design.md §11). Not an issue table: a triage queue.
// Regressed floats in its own red group, then New (first seen <24h),
// then Open — each ordered by objective importance (breadth, then
// depth, then recency). Filters are a few chips, not a query builder.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useShell } from '../App';
import { ImpactCell, KindBadge, RegressedBadge } from '../components/kind';
import { EmptyState, ErrorBanner, formatRelative } from '../components/ui';
import { useT } from '../i18n';
import { api, type IssueSummary } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

const KINDS = ['error', 'warn', 'trace', 'assert', 'probe'] as const;

export default function Inbox() {
  const t = useT();
  const { projects } = useShell();
  const [status, setStatus] = useState<'ignored' | 'open' | 'resolved'>('open');
  const [kind, setKind] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsyncData(
    () =>
      api.listIssues({
        status,
        kind: kind ?? undefined,
        projectId: projectId ?? undefined,
        limit: 200,
      }),
    [status, kind, projectId],
  );

  // Captured per render, not inside the memo (react-hooks/purity).
  const [now] = useState(() => Date.now());
  const groups = useMemo(() => {
    const issues = data?.issues ?? [];
    const dayAgo = now - 24 * 3600 * 1000;
    const regressed = issues.filter((i) => i.regressedAt && i.status === 'open');
    const rest = issues.filter((i) => !(i.regressedAt && i.status === 'open'));
    const fresh = rest.filter((i) => new Date(i.firstSeen).getTime() > dayAgo);
    const open = rest.filter((i) => new Date(i.firstSeen).getTime() <= dayAgo);
    return { regressed, fresh, open };
  }, [data, now]);

  const todayNew = groups.fresh.length;
  const todayRegressed = groups.regressed.length;

  // ── keyboard triage + bulk selection ──
  // One flat order across the three groups so j/k walks the page
  // exactly as the eye does: regressed, then new, then the rest.
  const flat = useMemo(
    () => [...groups.regressed, ...groups.fresh, ...groups.open],
    [groups],
  );
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(-1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const flatRef = useRef(flat);
  useEffect(() => {
    flatRef.current = flat;
  }, [flat]);

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function bulkAct(action: 'resolve' | 'ignore', ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          action === 'resolve' ? api.resolveIssue(id) : api.ignoreIssue(id),
        ),
      );
      setChecked(new Set());
      reload();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      )
        return;
      const list = flatRef.current;
      if (list.length === 0) return;
      if (e.key === 'j') {
        setCursor((c) => Math.min(c + 1, list.length - 1));
      } else if (e.key === 'k') {
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        setCursor((c) => {
          if (c >= 0 && c < list.length) navigate(`/issues/${list[c].id}`);
          return c;
        });
      } else if (e.key === 'x') {
        setCursor((c) => {
          if (c >= 0 && c < list.length) toggleChecked(list[c].id);
          return c;
        });
      } else if (e.key === 'r' || e.key === 'i') {
        const action = e.key === 'r' ? 'resolve' : 'ignore';
        setCursor((c) => {
          setChecked((sel) => {
            const ids = sel.size > 0 ? [...sel] : c >= 0 && c < list.length ? [list[c].id] : [];
            void bulkAct(action, ids);
            return sel;
          });
          return c;
        });
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // bulkAct/navigate are stable enough for a page-lifetime listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter changes reset the cursor + selection (set in the chip
  // handlers, not an effect, to avoid a cascading render).
  const resetTriage = () => {
    setCursor(-1);
    setChecked(new Set());
  };

  const cursorId = cursor >= 0 && cursor < flat.length ? flat[cursor].id : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      {/* pulse — one quiet line, never a chart page */}
      <div className="mb-4 font-mono text-xs opacity-60">
        {t('inbox.pulse', { fresh: String(todayNew), regressed: String(todayRegressed) })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['open', 'resolved', 'ignored'] as const).map((s) => (
          <Chip
            key={s}
            active={status === s}
            onClick={() => {
              resetTriage();
              setStatus(s);
            }}
          >
            {t(`inbox.status.${s}`)}
          </Chip>
        ))}
        <span className="mx-1 opacity-30">·</span>
        {KINDS.map((k) => (
          <Chip
            key={k}
            active={kind === k}
            onClick={() => {
              resetTriage();
              setKind(kind === k ? null : k);
            }}
          >
            {k}
          </Chip>
        ))}
        {projects.length > 1 && (
          <>
            <span className="mx-1 opacity-30">·</span>
            {projects.map((p) => (
              <Chip
                key={p.id}
                active={projectId === p.id}
                onClick={() => {
                  resetTriage();
                  setProjectId(projectId === p.id ? null : p.id);
                }}
              >
                {p.name}
              </Chip>
            ))}
          </>
        )}
      </div>

      {checked.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex items-center gap-3 rounded-md border border-[var(--gds-border,#2a2a30)] bg-[var(--gds-surface-raised,#1c1c22)] px-3 py-1.5 text-xs">
          <span className="font-medium">
            {t('inbox.selectedCount', { n: String(checked.size) })}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkAct('resolve', [...checked])}
            className="rounded bg-[var(--gds-accent,#4c8dff)] px-2 py-0.5 font-medium text-black disabled:opacity-40"
          >
            {t('issue.resolve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkAct('ignore', [...checked])}
            className="rounded border border-[var(--gds-border,#2a2a30)] px-2 py-0.5 disabled:opacity-40"
          >
            {t('issue.ignore')}
          </button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="ml-auto opacity-50 hover:opacity-100"
          >
            {t('inbox.clearSelection')}
          </button>
        </div>
      )}

      {error && (
        <ErrorBanner>
          {t('inbox.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </ErrorBanner>
      )}
      {loading && !data && <div className="py-16 text-center text-sm opacity-50">…</div>}

      {data && data.issues.length === 0 && (
        <EmptyState
          title={t('inbox.emptyTitle')}
          hint={projects.length === 0 ? t('inbox.emptyNoProject') : t('inbox.emptyHint')}
        />
      )}

      {groups.regressed.length > 0 && (
        <Group label={t('inbox.groupRegressed')} tone="danger">
          {groups.regressed.map((i) => (
            <Row
              key={i.id}
              issue={i}
              atCursor={i.id === cursorId}
              checked={checked.has(i.id)}
              onToggle={() => toggleChecked(i.id)}
            />
          ))}
        </Group>
      )}
      {groups.fresh.length > 0 && (
        <Group label={t('inbox.groupNew')}>
          {groups.fresh.map((i) => (
            <Row
              key={i.id}
              issue={i}
              atCursor={i.id === cursorId}
              checked={checked.has(i.id)}
              onToggle={() => toggleChecked(i.id)}
            />
          ))}
        </Group>
      )}
      {groups.open.length > 0 && (
        <Group label={t(`inbox.group.${status}`)}>
          {groups.open.map((i) => (
            <Row
              key={i.id}
              issue={i}
              atCursor={i.id === cursorId}
              checked={checked.has(i.id)}
              onToggle={() => toggleChecked(i.id)}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? 'border-transparent bg-[var(--gds-surface-raised,#26262c)] font-medium'
          : 'border-[var(--gds-border,#2a2a30)] opacity-60 hover:opacity-100'
      }`}
    >
      {children}
    </button>
  );
}

function Group({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2
        className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${
          tone === 'danger' ? 'text-[#ff5d5d]' : 'opacity-50'
        }`}
      >
        {label}
      </h2>
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {children}
      </div>
    </section>
  );
}

function Row({
  issue,
  atCursor,
  checked,
  onToggle,
}: {
  issue: IssueSummary;
  atCursor: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const surface = issue.surface as { screen?: string; element?: string };
  const where = [surface.screen, surface.element].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/issues/${issue.id}`}
      data-cursor={atCursor || undefined}
      className={`group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--gds-surface-raised,#1c1c22)] ${
        atCursor ? 'bg-[var(--gds-surface-raised,#1c1c22)] ring-1 ring-inset ring-[var(--gds-accent,#4c8dff)]' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        className={`h-3.5 w-3.5 accent-[var(--gds-accent,#4c8dff)] ${
          checked ? '' : 'opacity-0 transition-opacity group-hover:opacity-60'
        }`}
      />
      <KindBadge kind={issue.kind} />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{issue.title}</span>
        {issue.messageSample && (
          <span className="ml-2 opacity-50">{issue.messageSample}</span>
        )}
        {where && <span className="ml-2 font-mono text-xs opacity-40">{where}</span>}
      </span>
      {issue.regressedAt && issue.status === 'open' && <RegressedBadge />}
      <ImpactCell
        users={issue.usersCount}
        maxPerUser={issue.maxPerUser}
        events={issue.eventCount}
      />
      <span className="w-16 text-right font-mono text-[11px] opacity-40">
        {formatRelative(issue.lastSeen)}
      </span>
    </Link>
  );
}
