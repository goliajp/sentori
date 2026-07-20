// Token management page — mint / list / revoke SDK ingest tokens.
//
// This is the new-customer onboarding step that produces the
// `st_pk_<26 base32>` string they paste into SDK init().

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
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
  formatRelative,
} from '../components/ui';

export default function Tokens() {
  const { id: projectId } = useParams<{ id: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);

  const {
    data,
    loading,
    error,
    reload: refresh,
    setError,
  } = useAsyncData(
    async () => (projectId ? (await api.listTokens(projectId)).tokens : []),
    [projectId],
    String,
  );
  const rows = data ?? [];

  async function mint() {
    if (!projectId) return;
    try {
      const r = await api.mintToken(projectId, {
        label: label.trim() || undefined,
        kind: 'public',
      });
      setNewToken(r.token);
      setLabel('');
      setShowCreate(false);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? SDKs using it will start returning 401.'))
      return;
    try {
      await api.revokeToken(id);
      refresh();
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
        title="Tokens"
        subtitle="SDK ingest credentials. Paste into init({ token })."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            + Mint token
          </Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {newToken && (
        <Card>
          <CardHeader title="New token (shown once)" />
          <Section>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-zinc-50 p-3 text-xs font-mono">
              {newToken}
            </pre>
            <div className="text-xs text-zinc-500 mt-2">
              Copy this now — it won't be shown again. Plaintext lives only in
              your dashboard session.
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(newToken);
                }}
              >
                Copy
              </Button>
              <Button
                variant="secondary"
                onClick={() => setNewToken(null)}
              >
                Done
              </Button>
            </div>
          </Section>
        </Card>
      )}
      {showCreate && (
        <Card>
          <CardHeader title="Mint new token" />
          <Section>
            <input
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              placeholder="Label (e.g. 'production iOS')"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button onClick={mint}>Create</Button>
              <Button
                variant="secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
            </div>
          </Section>
        </Card>
      )}
      <Card>
        <CardHeader title={`Tokens (${rows.length})`} />
        <Section>
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-500">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No tokens yet"
              hint="Mint one to get your SDK ingesting events."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'label', label: 'Label' },
                { key: 'kind', label: 'Kind' },
                { key: 'last4', label: 'Token …' },
                { key: 'created', label: 'Created' },
                { key: 'status', label: 'Status' },
                { key: 'actions', label: '' },
              ]}
              rows={rows.map(t => ({
                key: t.id,
                label: t.label || '(unlabelled)',
                kind: <Badge>{t.kind}</Badge>,
                last4: t.last4 ? `…${t.last4}` : '—',
                created: formatRelative(t.created_at),
                status: t.revoked_at ? (
                  <Badge tone="neutral">revoked</Badge>
                ) : (
                  <Badge tone="ok">active</Badge>
                ),
                actions: !t.revoked_at && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => revoke(t.id)}
                  >
                    Revoke
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
