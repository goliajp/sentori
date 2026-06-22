// Push credentials admin — upsert / list / delete vendor secrets
// (APNs, FCM, WebPush, HCM, MiPush).

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api, PushCredential } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Section,
} from '../components/ui';

const PROVIDERS = ['apns', 'fcm', 'webpush', 'hcm', 'mipush'] as const;

export default function PushCredentials() {
  const { id: projectId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<PushCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('apns');
  const [config, setConfig] = useState('{}');
  const [secret, setSecret] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listPushCredentials(projectId);
      setRows(r.credentials);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [projectId]);

  async function upload() {
    if (!projectId) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      setError('Config must be valid JSON');
      return;
    }
    try {
      await api.upsertPushCredential(projectId, {
        provider,
        config: parsed,
        secret: secret || undefined,
      });
      setConfig('{}');
      setSecret('');
      setShowUpload(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function destroy(kind: string) {
    if (!projectId) return;
    if (!confirm(`Delete ${kind} credentials? Pending pushes will fail.`)) return;
    try {
      await api.deletePushCredential(projectId, kind);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!projectId) {
    return <ErrorBanner>Project id missing</ErrorBanner>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Push credentials"
        subtitle="Vendor secrets used by /v1/push/send. APNs p8, FCM service-account, WebPush VAPID, HCM/MiPush client secrets."
        actions={
          <Button onClick={() => setShowUpload(true)}>+ Upload</Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {showUpload && (
        <Card>
          <CardHeader title="Upload credentials" />
          <Section>
            <label className="block text-xs text-zinc-500 mb-1">Provider</label>
            <select
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              value={provider}
              onChange={e =>
                setProvider(e.target.value as (typeof PROVIDERS)[number])
              }
            >
              {PROVIDERS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-xs text-zinc-500 mb-1">
              Config (JSON — key id, team id, project id, vapid public key, …)
            </label>
            <textarea
              className="w-full h-32 rounded border border-zinc-300 px-3 py-2 text-xs font-mono"
              value={config}
              onChange={e => setConfig(e.target.value)}
            />

            <label className="mt-3 block text-xs text-zinc-500 mb-1">
              Secret (APNs p8 / FCM service-account json / VAPID private key)
            </label>
            <textarea
              className="w-full h-32 rounded border border-zinc-300 px-3 py-2 text-xs font-mono"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----\n..."
            />

            <div className="mt-3 flex gap-2">
              <Button onClick={upload}>Save</Button>
              <Button variant="secondary" onClick={() => setShowUpload(false)}>
                Cancel
              </Button>
            </div>
          </Section>
        </Card>
      )}
      <Card>
        <CardHeader title={`Configured (${rows.length})`} />
        <Section>
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No credentials yet"
              message="Upload at least one provider to start dispatching push."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'kind', label: 'Provider' },
                { key: 'status', label: 'Last validate' },
                { key: 'actions', label: '' },
              ]}
              rows={rows.map(c => ({
                key: c.id,
                kind: <Badge>{c.kind}</Badge>,
                status:
                  c.last_validate_status === 'ok' ? (
                    <Badge variant="ok">ok</Badge>
                  ) : c.last_validate_status ? (
                    <Badge variant="muted">{c.last_validate_status}</Badge>
                  ) : (
                    <span className="text-xs text-zinc-400">never</span>
                  ),
                actions: (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => destroy(c.kind)}
                  >
                    Delete
                  </Button>
                ),
              }))}
            />
          )}
        </Section>
      </Card>
    </div>
  );
}
