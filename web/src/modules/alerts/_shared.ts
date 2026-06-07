// v2.16 — shared, non-component helpers for the alerts module.
// Lives in `_shared.ts` so `view.tsx` only exports components
// (avoids the React Fast Refresh export-shape warning).

import type { AlertRule, AlertRuleInput, AlertTriggerKind } from '@/api/client'

export function triggerLabel(
  kind: AlertTriggerKind,
  cfg: AlertRule['triggerConfig'] | AlertRuleInput['triggerConfig']
): string {
  switch (kind) {
    case 'new_issue':
      return 'new issue'
    case 'regression':
      return 'regression'
    case 'event_count':
      return `≥ ${cfg?.count ?? '?'} events / ${cfg?.windowMinutes ?? '?'} min`
    case 'crash_free_drop':
      return `crash-free < ${cfg?.threshold ?? '?'} / ${cfg?.windowMinutes ?? '?'} min`
    default:
      return kind
  }
}
