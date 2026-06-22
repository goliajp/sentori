import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, Project, UsageResponse } from '../lib/api';
import { Sparkline } from '../components/Sparkline';
import {
  Card,
  CardHeader,
  ErrorBanner,
  PageHeader,
  formatNumber,
} from '../components/ui';

export function OverviewPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [trends, setTrends] = useState<Record<string, number[]>>({});

  useEffect(() => {
    Promise.all([api.listProjects(), api.usage()])
      .then(async ([p, u]) => {
        setProjects(p);
        setUsage(u);
        // Fetch 7-day trend per project in parallel
        const t = await Promise.all(
          p.map(async pr => {
            try {
              const series = await api.eventsTrend(pr.id, 7);
              return [pr.id, series.map(d => d.count)] as const;
            } catch {
              return [pr.id, []] as const;
            }
          }),
        );
        setTrends(Object.fromEntries(t));
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, []);

  return (
    <div className="p-8">
      <PageHeader
        title="Overview"
        subtitle="Workspace-wide health + this-period usage."
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}

      {usage && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <UsageCard title="Events" {...usage.events} />
          <UsageCard title="Spans" {...usage.spans} />
          <UsageCard title="Replays" {...usage.replays} />
        </div>
      )}

      <Card>
        <CardHeader
          title="Projects"
          subtitle={
            projects ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'Loading…'
          }
        />
        {projects?.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No projects yet. Create your first project to start ingesting events.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {projects?.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/projects/${p.id}/issues`}
                    className="text-sm font-medium text-zinc-100 hover:text-brand-400"
                  >
                    {p.name}
                  </Link>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {p.slug}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-mono text-xs text-zinc-400">7d events</p>
                    <p className="font-mono text-sm text-zinc-200">
                      {trends[p.id]
                        ? formatNumber(
                            trends[p.id].reduce((a, b) => a + b, 0),
                          )
                        : '—'}
                    </p>
                  </div>
                  <Sparkline
                    values={trends[p.id] ?? []}
                    width={140}
                    height={36}
                  />
                  <Link
                    to={`/projects/${p.id}/issues`}
                    className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                  >
                    Issues →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UsageCard({
  title,
  count,
  dropped,
  limit,
}: {
  title: string;
  count: number;
  dropped: number;
  limit: number;
}) {
  const pct = limit > 0 && limit < Number.MAX_SAFE_INTEGER
    ? Math.min(100, Math.round((count / limit) * 100))
    : 0;
  const isUnlimited = limit >= Number.MAX_SAFE_INTEGER || limit > 1e15;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="mt-1 font-mono text-2xl text-zinc-100">{formatNumber(count)}</p>
      <p className="text-xs text-zinc-500">
        {isUnlimited ? 'unlimited' : `of ${formatNumber(limit)} / month (${pct}%)`}
      </p>
      {dropped > 0 && (
        <p className="mt-1 text-xs text-red-400">
          dropped: {formatNumber(dropped)}
        </p>
      )}
      {!isUnlimited && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-brand-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
