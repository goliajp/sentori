import { Accordion, AccordionItem, PageHeader } from '@goliapkg/gds'

import { UsersErase } from './erase'
import { UsersLookup } from './lookup'
import { UsersMerge } from './merge'
import { UsersOverview } from './overview'

function deepLinkedAccordion(): string[] {
  if (typeof window === 'undefined') return []
  const params = new URLSearchParams(window.location.search)
  const hash = params.get('hash')
  if (hash && /^[a-f0-9]{64}$/.test(hash)) return ['lookup']
  return []
}

/**
 * v2.4 — Users module shell.
 *
 * Page is a GDS `Accordion` over three operator actions (lookup /
 * merge / erase) stacked above `UsersOverview`. Deep-link rule:
 * arriving via `?hash=…` auto-expands the lookup section so the
 * operator lands on the resolved result instead of an empty form.
 * Erase + merge stay collapsed by default (destructive / rare).
 */
export function UsersView() {
  return (
    <div className="space-y-4">
      <PageHeader
        subtitle="identified fingerprints · raw values never leave your browser"
        title="Users"
      />

      <Accordion defaultExpanded={deepLinkedAccordion()} type="multiple">
        <AccordionItem id="lookup" title="Lookup by identity">
          <UsersLookup />
        </AccordionItem>
        <AccordionItem id="merge" title="Merge identities">
          <UsersMerge />
        </AccordionItem>
        <AccordionItem id="erase" title="Erase identity (DSR)">
          <UsersErase />
        </AccordionItem>
      </Accordion>

      <UsersOverview />
    </div>
  )
}
