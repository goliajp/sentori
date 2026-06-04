/**
 * Two small text wrappers that recur across dashboard views — pulled
 * out of 7 duplicated local definitions (2026-05-23 polish pass).
 *
 * - `<Hint>`: inline form helper text (py-4, left-aligned, no center).
 *   Use it next to an input or below a settings row when the
 *   surrounding context already establishes the eye-level — Linear's
 *   "muted helper paragraph under a field" pattern.
 *
 * - `<EmptyState>`: top-level empty / loading-failure message
 *   (py-6, centered). Use it when a list / table query returned no
 *   rows or errored — the message stands alone on the page below
 *   the PageHeader.
 *
 * Both accept `danger` to recolor the text in `--danger` (red) for
 * error messages. Default `--ink-soft` (muted) is the right tone
 * for empty / informational messages.
 */
export function Hint({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <p
      className={`border-border/40 border-y py-4 text-[13px] ${
        danger ? 'text-danger' : 'text-fg-secondary'
      }`}
    >
      {children}
    </p>
  )
}

export function EmptyState({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <p
      className={`border-border/40 border-y py-6 text-center text-[13px] ${
        danger ? 'text-danger' : 'text-fg-secondary'
      }`}
    >
      {children}
    </p>
  )
}

/**
 * Module-level empty state — typed eyebrow (uppercase accent label
 * identifying which module is empty) above a wider hint paragraph.
 * Replaces 5 duplicate `EmptyMessage` definitions across audience /
 * posture sub-views (2026-05-23 polish pass).
 *
 * The eyebrow is the module's branding token (e.g. "posture",
 * "behavior") — matches the PageHeader's tracking + uppercase
 * styling so the empty state still feels like the module's
 * surface, not a generic 404.
 */
export function ModuleEmpty({ children, eyebrow }: { children: React.ReactNode; eyebrow: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="text-accent mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
        {eyebrow}
      </div>
      <div
        className="text-fg-secondary mx-auto text-[13px] leading-relaxed"
        style={{ maxWidth: '56ch' }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Narrow empty for sidebar rails / list panels — same eyebrow +
 * muted-paragraph shape as ModuleEmpty, just sized to live inside
 * a 280-320px column. Eyebrow defaults to "empty" because in rail
 * context (issues list, moments list, metric names list) there's
 * usually no module identity to surface — the rail's own header
 * already establishes it.
 *
 * Replaces 3 duplicates: RailEmpty (moments, issues) and EmptyRail
 * (metrics).
 */
export function RailEmpty({
  children,
  eyebrow = 'empty',
}: {
  children: React.ReactNode
  eyebrow?: string
}) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-accent mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
        {eyebrow}
      </div>
      <div
        className="text-fg-secondary mx-auto text-[13px] leading-relaxed"
        style={{ maxWidth: '28ch' }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Full-height vertically-centered empty for panels that own their
 * container's full height (a detail-pane that hasn't loaded a row
 * yet, an embedded chart placeholder). Same eyebrow + muted text;
 * the wrapper is the `flex h-full items-center justify-center`
 * positioning that pins to the middle.
 *
 * Replaces 2 duplicates: Placeholder (metrics, moments).
 */
export function CenteredEmpty({
  children,
  eyebrow,
}: {
  children: React.ReactNode
  eyebrow?: string
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        {eyebrow != null && (
          <div className="text-accent mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
            {eyebrow}
          </div>
        )}
        <div className="text-fg-secondary text-[13px]">{children}</div>
      </div>
    </div>
  )
}
