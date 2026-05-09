import { useParams } from 'react-router'

export function IssueDetailView() {
  const { issueId } = useParams<{ issueId: string }>()
  return (
    <div className="px-6 py-6">
      <h2 className="text-fg text-base font-semibold">Issue detail</h2>
      <p className="text-fg-muted mt-2 text-sm">
        Issue id: <span className="font-mono">{issueId}</span>
      </p>
      <p className="text-fg-muted mt-2 text-sm">Stub — full UI coming in sub-section C.</p>
    </div>
  )
}
