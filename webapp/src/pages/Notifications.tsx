// Per-user notification inbox.

import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorBanner,
  PageHeader,
  formatRelative,
} from '../components/ui';

interface Row {
  id: string;
  kind: string;
  payload: unknown;
  read_at: string | null;
  created_at: string;
}

export default function Notifications() {
  const { data, loading, error, setData } = useAsyncData(
    async (): Promise<Row[]> => (await api.listNotifications()).notifications,
    [],
    String,
  );
  const rows = data ?? [];

  async function readOne(id: string) {
    await api.markNotificationRead(id);
    setData(rs =>
      rs?.map(r =>
        r.id === id && !r.read_at
          ? { ...r, read_at: new Date().toISOString() }
          : r,
      ) ?? null,
    );
  }

  async function readAll() {
    await api.markAllNotificationsRead();
    const now = new Date().toISOString();
    setData(rs => rs?.map(r => (r.read_at ? r : { ...r, read_at: now })) ?? null);
  }

  const unread = rows.filter(r => !r.read_at).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        subtitle={
          unread > 0
            ? `${unread} unread`
            : 'No unread notifications.'
        }
        actions={
          unread > 0 ? (
            <Button onClick={readAll} variant="secondary" size="sm">
              Mark all read
            </Button>
          ) : null
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <CardHeader title={`Inbox (${rows.length})`} />
        <CardBody>
          {loading ? (
            <div className="py-8 text-center text-sm text-fg-subtle">
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-fg-subtle">
              No notifications.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(n => (
                <li
                  key={n.id}
                  onClick={() => !n.read_at && readOne(n.id)}
                  className={`flex items-center justify-between gap-3 px-2 py-3 cursor-pointer ${
                    n.read_at ? 'opacity-60' : 'hover:bg-surface/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge>{n.kind}</Badge>
                      {!n.read_at && (
                        <span className="text-accent">●</span>
                      )}
                    </div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs font-mono text-fg-subtle">
                      {JSON.stringify(n.payload)}
                    </pre>
                  </div>
                  <span className="text-xs text-fg-subtle w-24 text-right">
                    {formatRelative(n.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
