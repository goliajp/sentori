import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, CertObservation } from '../lib/api';
import {
  Badge,
  Card,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function CertPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [observations, setObservations] = useState<CertObservation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api
      .listCertObservations(projectId)
      .then(setObservations)
      .catch((e: unknown) => {
        if (e instanceof ApiError) setErr(`${e.status}: ${e.body}`);
        else setErr(String(e));
      });
  }, [projectId]);

  if (!projectId) return <div className="p-8">no project id</div>;

  const now = Date.now();
  function daysUntil(iso: string): number {
    return Math.round((new Date(iso).getTime() - now) / (1000 * 60 * 60 * 24));
  }
  function expiryTone(days: number) {
    if (days < 0) return 'danger';
    if (days < 14) return 'warn';
    if (days < 60) return 'info';
    return 'ok';
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Certificate monitor"
        subtitle="CT log observations for watched domains. K10."
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <Card>
        <DataTable
          rowKey={(r) => r.id}
          empty="No cert observations yet. Add a watched domain to start polling crt.sh."
          rows={observations ?? []}
          columns={[
            {
              key: 'domain',
              label: 'Domain',
              render: (r) => (
                <div>
                  <div className="font-mono text-sm text-zinc-100">{r.domain}</div>
                  {r.common_name && (
                    <div className="text-[11px] text-zinc-500">
                      CN: {r.common_name}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'issuer_name',
              label: 'Issuer',
              width: '25%',
              render: (r) => (
                <span className="text-xs text-zinc-400">
                  {r.issuer_name.slice(0, 50)}
                </span>
              ),
            },
            {
              key: 'not_after',
              label: 'Expires',
              width: '15%',
              render: (r) => {
                const d = daysUntil(r.not_after);
                return (
                  <Badge tone={expiryTone(d)}>
                    {d < 0 ? `expired ${-d}d ago` : `${d}d`}
                  </Badge>
                );
              },
            },
            {
              key: 'observed_at',
              label: 'Observed',
              width: '15%',
              render: (r) => (
                <span className="text-xs text-zinc-500">
                  {formatRelative(r.observed_at)}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
