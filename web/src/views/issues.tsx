import { useQuery } from '@tanstack/react-query'

import { adminApi, DEV_PROJECT_ID } from '@/api/client'

export function IssuesView() {
  const { data, isLoading, error } = useQuery({
    queryFn: () => adminApi.listIssues(DEV_PROJECT_ID, { status: 'active' }),
    queryKey: ['issues', DEV_PROJECT_ID, 'active'],
  })

  return (
    <div className="px-6 py-6">
      <h2 className="text-fg mb-4 text-base font-semibold">Issues</h2>
      {isLoading && <p className="text-fg-muted text-sm">Loading…</p>}
      {error && <p className="text-sm text-red-400">Failed to load issues.</p>}
      {!isLoading && !error && (!data || data.length === 0) && (
        <p className="text-fg-muted text-sm">No active issues.</p>
      )}
      {data && data.length > 0 && (
        <p className="text-fg-muted text-sm">
          {data.length} active issue{data.length === 1 ? '' : 's'} — dense table coming in
          sub-section B.
        </p>
      )}
    </div>
  )
}
