// v1.2 W8 — notification bell in the toolbar.
//
// Polls /admin/api/notifications every 60s for the unread feed and
// also subscribes to /admin/api/notifications/stream (SSE) for
// real-time updates. The SSE stream is a nice-to-have — polling
// guarantees correctness even if the SSE transport drops.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { adminApi, type Notification } from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'
import { qk } from '@/api/query-keys'
import { formatRelative } from '@/lib/format'

export function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { currentOrg } = useOrg()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: unread } = useQuery({
    enabled: !!user,
    queryFn: () => adminApi.listNotifications({ unread: true, limit: 20 }),
    queryKey: qk.notifications.unread(),
    // 60s polling — covers the case where the SSE connection drops.
    refetchInterval: 60_000,
  })
  const { data: recent } = useQuery({
    enabled: !!user && open,
    queryFn: () => adminApi.listNotifications({ limit: 30 }),
    queryKey: qk.notifications.recent(),
  })

  // SSE stream — appends arriving rows to the unread cache.
  useEffect(() => {
    if (!user) return undefined
    const es = new EventSource('/admin/api/notifications/stream', {
      withCredentials: true,
    })
    es.addEventListener('notification', () => {
      void qc.invalidateQueries({ queryKey: qk.notifications.unread() })
      void qc.invalidateQueries({ queryKey: qk.notifications.recent() })
    })
    return () => es.close()
  }, [qc, user])

  if (!user) return null
  const count = unread?.length ?? 0
  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        className="relative flex h-7 w-7 items-center justify-center text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-block min-w-[14px] rounded-full bg-[color:var(--accent)] px-1 text-center font-mono text-[9px] leading-[14px] text-[color:var(--paper)]">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute top-9 right-0 z-50 w-[360px] border border-[color:var(--rule)] bg-[color:var(--paper)] shadow-lg"
          role="dialog"
        >
          <div className="flex items-center justify-between border-b border-[color:var(--rule)] px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              Notifications
            </span>
            {count > 0 && (
              <button
                className="font-mono text-[10px] text-[color:var(--accent)] uppercase hover:underline"
                onClick={() => {
                  void adminApi.markAllNotificationsRead().then(() => {
                    void qc.invalidateQueries({ queryKey: qk.notifications.unread() })
                    void qc.invalidateQueries({ queryKey: qk.notifications.recent() })
                  })
                }}
                type="button"
              >
                mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-[color:var(--rule-soft)] overflow-y-auto">
            {(recent ?? unread ?? []).length === 0 && (
              <li className="px-3 py-6 text-center text-[12px] text-[color:var(--ink-muted)]">
                Nothing here yet.
              </li>
            )}
            {(recent ?? unread ?? []).map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onClick={() => {
                  setOpen(false)
                  if (currentOrg) {
                    navigate(`/main/org/${currentOrg.slug}/issues/${n.issueId}`)
                  }
                  if (!n.readAt) {
                    void adminApi.markNotificationRead(n.id).then(() => {
                      void qc.invalidateQueries({ queryKey: qk.notifications.unread() })
                      void qc.invalidateQueries({ queryKey: qk.notifications.recent() })
                    })
                  }
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NotificationRow({
  notification,
  onClick,
}: {
  notification: Notification
  onClick: () => void
}) {
  const unread = !notification.readAt
  return (
    <li>
      <button
        className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[color:var(--paper-2)] ${
          unread ? 'bg-[color:var(--accent-soft)]/40' : ''
        }`}
        onClick={onClick}
        type="button"
      >
        <span
          aria-hidden
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
            unread ? 'bg-[color:var(--accent)]' : 'bg-transparent'
          }`}
        />
        <span className="flex-1">
          <span className="block text-[12px] text-[color:var(--ink)]">
            {kindLabel(notification.kind)}
          </span>
          <span className="block font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)]">
            {formatRelative(notification.createdAt)} · issue {notification.issueId.slice(0, 8)}
          </span>
        </span>
      </button>
    </li>
  )
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'commented':
      return 'New comment'
    case 'status_changed':
      return 'Status changed'
    case 'assignee_changed':
      return 'Assignee changed'
    case 'priority_changed':
      return 'Priority changed'
    case 'labels_changed':
      return 'Labels changed'
    case 'merged':
      return 'Merged'
    case 'regressed':
      return 'Regressed'
    default:
      return kind.replace(/_/g, ' ')
  }
}
