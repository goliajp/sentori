import { useNavigate } from 'react-router'

import type { OrgRow } from '@/api/client'

export function OrgSwitcher({ current, orgs }: { current: null | OrgRow; orgs: OrgRow[] }) {
  const navigate = useNavigate()

  return (
    <select
      className="border-border bg-bg-tertiary text-fg hover:border-accent/50 focus:ring-accent rounded-md border px-2 py-1 text-[13px] focus:ring-1 focus:outline-none"
      onChange={(e) => navigate(`/org/${e.target.value}/issues`)}
      value={current?.slug ?? ''}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.slug}>
          {o.name}
        </option>
      ))}
    </select>
  )
}
