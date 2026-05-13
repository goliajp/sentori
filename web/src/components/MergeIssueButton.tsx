import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { adminApi } from '@/api/client'

/**
 * Phase 44 sub-C — manual fingerprint rewrite via merge.
 *
 * Click → small inline form, paste the target issue id (UUID), Save
 * → server moves events + deletes the source. We then redirect the
 * dashboard to the target issue so the operator lands on the
 * surviving record.
 *
 * Why no fuzzy picker: target id is unambiguous, the dashboard
 * already shows it in the URL when a user navigates to the other
 * issue, and the rare "wrong direction" mistake is fixable by
 * re-merging from the now-orphaned events. A search-based picker
 * is nice-to-have, leave it for a follow-up.
 */
export function MergeIssueButton({
  issueId,
  orgSlug,
  projectId,
}: {
  issueId: string
  orgSlug: string
  projectId: string
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [error, setError] = useState<null | string>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const merge = useMutation({
    mutationFn: () => adminApi.mergeIssue(projectId, issueId, target.trim()),
    onError: (e: unknown) => {
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setError(body?.error ?? 'merge failed')
    },
    onSuccess: ({ targetIssueId }) => {
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
      setOpen(false)
      setTarget('')
      navigate(`/org/${orgSlug}/issues/${targetIssueId}`)
    },
  })

  if (!open) {
    return (
      <button
        className="border-border hover:border-accent/60 hover:text-fg text-fg-muted rounded-md border px-2 py-1 text-[11px]"
        onClick={() => setOpen(true)}
        title="Merge this issue's events into another issue"
        type="button"
      >
        ⇆ Merge
      </button>
    )
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const t = target.trim()
        if (!isValidUuid(t)) {
          setError('Target must be a UUID')
          return
        }
        if (t === issueId) {
          setError('Cannot merge an issue with itself')
          return
        }
        merge.mutate()
      }}
    >
      <input
        aria-label="Target issue id"
        className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 font-mono text-[10px]"
        onChange={(e) => {
          setTarget(e.target.value)
          setError(null)
        }}
        placeholder="target issue UUID"
        spellCheck={false}
        style={{ width: '20rem' }}
        type="text"
        value={target}
      />
      {error && <span className="text-[10px] text-red-300">{error}</span>}
      <button
        className="border-accent/60 text-accent hover:bg-accent/10 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
        disabled={merge.isPending || !target.trim()}
        type="submit"
      >
        {merge.isPending ? 'Merging…' : 'Merge'}
      </button>
      <button
        className="text-fg-muted hover:text-fg text-[11px]"
        onClick={() => {
          setOpen(false)
          setError(null)
        }}
        type="button"
      >
        Cancel
      </button>
    </form>
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(s: string): boolean {
  return UUID_RE.test(s)
}
