import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, CertObservation, CertWatch } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

export function CertPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const {
    data,
    error: err,
    reload: refresh,
    setError: setErr,
  } = useAsyncData(async () => {
    if (!projectId) return null;
    const [o, w] = await Promise.all([
      api.listCertObservations(projectId),
      api.listCertWatches(projectId).catch(() => [] as CertWatch[]),
    ]);
    return { observations: o, watches: w };
  }, [projectId]);
  const observations: CertObservation[] | null = data?.observations ?? null;
  const watches: CertWatch[] = data?.watches ?? [];

  async function addDomain() {
    if (!projectId || !newDomain.trim()) return;
    try {
      await api.addCertWatch(projectId, newDomain.trim());
      setNewDomain('');
      setShowAdd(false);
      refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function removeDomain(domain: string) {
    if (!projectId) return;
    if (!confirm(`Stop watching ${domain}? Existing observations stay.`)) return;
    try {
      await api.removeCertWatch(projectId, domain);
      refresh();
    } catch (e) {
      setErr(String(e));
    }
  }

  if (!projectId) return <div>no project id</div>;

  function daysUntil(iso: string): number {
    const now = Date.now();
    return Math.round((new Date(iso).getTime() - now) / (1000 * 60 * 60 * 24));
  }
  function expiryTone(days: number) {
    if (days < 0) return 'danger';
    if (days < 14) return 'warn';
    if (days < 60) return 'info';
    return 'ok';
  }

  return (
    <div>
      <PageHeader
        title="Certificate monitor"
        subtitle="CT log observations for watched domains."
        actions={
          <Button onClick={() => setShowAdd(true)}>+ Watch domain</Button>
        }
      />
      {err && <ErrorBanner>{err}</ErrorBanner>}

      {showAdd && (
        <Card className="mb-4">
          <CardHeader title="Watch new domain" />
          <div className="px-5 py-4 space-y-2">
            <input
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm font-mono"
              placeholder="example.com"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={addDomain}>Add</Button>
              <Button variant="secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {watches.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={`Watched (${watches.length})`} />
          <div className="px-5 py-4 space-y-1">
            {watches.map(w => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded border border-border px-3 py-1.5"
              >
                <span className="font-mono text-sm text-fg">
                  {w.domain}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => removeDomain(w.domain)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                  <div className="font-mono text-sm text-fg">{r.domain}</div>
                  {r.common_name && (
                    <div className="text-xs text-fg-subtle">
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
                <span className="text-xs text-fg-muted">
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
                <span className="text-xs text-fg-subtle">
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
