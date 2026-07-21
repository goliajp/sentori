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
      <Quickstart projectId={projectId} token={newToken} />
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

// The SaaS ingest host is the SDK's built-in default `ingestUrl`;
// it never appears in the dashboard otherwise, so surface it here.
const DEFAULT_INGEST_URL = 'https://ingest.sentori.golia.jp';

function Quickstart({
  projectId,
  token,
}: {
  projectId: string;
  token: string | null;
}) {
  const tk = token ?? 'st_pk_<your project token>';
  const snippet = `import { sentori } from '@goliapkg/sentori-react-native';

sentori.init({
  token: '${tk}',
  release: 'myapp@1.0.0+1',
  ingestUrl: '${DEFAULT_INGEST_URL}', // optional — this is the default
});`;
  return (
    <Card>
      <CardHeader
        title="Quickstart"
        subtitle="Drop this into your app's entry point to start ingesting."
      />
      <Section>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label="Ingest URL" value={DEFAULT_INGEST_URL} />
          <Field label="Project ID" value={projectId} mono />
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded bg-zinc-950 p-3 text-xs font-mono text-zinc-200">
            {snippet}
          </pre>
          <div className="absolute right-2 top-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(snippet)}
            >
              Copy
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {token
            ? 'Token above is the one you just minted.'
            : 'Mint a token above and it fills in here automatically. Other frameworks: swap the import (@goliapkg/sentori-react, -vue, -svelte, …); the init shape is identical.'}
        </p>
      </Section>
    </Card>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`truncate text-xs text-zinc-200 ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </span>
        <button
          onClick={() => navigator.clipboard?.writeText(value)}
          className="shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          copy
        </button>
      </div>
    </div>
  );
}
