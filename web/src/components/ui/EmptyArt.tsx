/**
 * Phase 50 sub-E5 — context-specific illustrations for EmptyState.
 *
 * Hand-rolled SVGs using `currentColor` so they pick up the
 * surrounding text color (typically `text-fg-muted`). Each is ~80px
 * square and uses sparse 1.5px strokes so they read as outlines on
 * dark + light themes equally.
 *
 *     <EmptyState icon={<EmptyArt kind="issues" />} title="No active issues" />
 *
 * The original `∅` glyph fallback still works in EmptyState — pass
 * the icon prop only when there's a context-fitting illustration.
 */

type Kind =
  | 'audit'
  | 'attachments'
  | 'events'
  | 'integrations'
  | 'issues'
  | 'project'
  | 'releases'
  | 'traces'
  | 'tags'

export function EmptyArt({ kind }: { kind: Kind }) {
  return (
    <svg
      aria-hidden
      className="text-fg-muted/70"
      fill="none"
      height="64"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 64 64"
      width="64"
    >
      {kind === 'issues' && (
        <>
          {/* speech-bubble + bug feet, "no active issues" */}
          <path d="M10 14h44v22a4 4 0 0 1-4 4H22l-8 6v-6h-4a4 4 0 0 1-4-4Z" />
          <path d="M22 24l8 8m0 0 8-8m-8 8v8" opacity="0.5" />
        </>
      )}
      {kind === 'releases' && (
        <>
          {/* tag with hole + ribbon */}
          <path d="M30 8 8 30a4 4 0 0 0 0 5.6L28.4 56a4 4 0 0 0 5.6 0L56 34V14a6 6 0 0 0-6-6Z" />
          <circle cx="44" cy="20" r="3" />
        </>
      )}
      {kind === 'traces' && (
        <>
          {/* connected nodes */}
          <circle cx="14" cy="14" r="4" />
          <circle cx="32" cy="32" r="4" />
          <circle cx="50" cy="14" r="4" />
          <circle cx="50" cy="50" r="4" />
          <path d="M18 14h14M18 14l11 14M50 18v10M36 36l10 10" opacity="0.6" />
        </>
      )}
      {kind === 'events' && (
        <>
          {/* clock with sparkle */}
          <circle cx="28" cy="32" r="20" />
          <path d="M28 22v10l6 6" />
          <path d="M50 12l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" opacity="0.6" />
        </>
      )}
      {kind === 'project' && (
        <>
          {/* folder + plus */}
          <path d="M6 18h18l4 4h30v32a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z" />
          <path d="M32 36v12M26 42h12" opacity="0.6" />
        </>
      )}
      {kind === 'audit' && (
        <>
          {/* lined paper + magnifier */}
          <path d="M14 8h26l10 10v34a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" />
          <path d="M40 8v10h10" />
          <circle cx="40" cy="42" r="6" />
          <path d="m44 46 5 5" />
          <path d="M18 24h18M18 30h22M18 36h10" opacity="0.6" />
        </>
      )}
      {kind === 'integrations' && (
        <>
          {/* chain link */}
          <path d="M22 32a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8v0a8 8 0 0 1-8 8h-2" />
          <path d="M42 32a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8v0a8 8 0 0 1 8-8h2" />
        </>
      )}
      {kind === 'attachments' && (
        <>
          {/* paperclip */}
          <path d="M44 22 24 42a6 6 0 1 1-8.5-8.5l20-20a10 10 0 0 1 14 14L30.5 47a14 14 0 0 1-20-20" />
        </>
      )}
      {kind === 'tags' && (
        <>
          {/* hash + tag */}
          <path d="M20 12 16 52M40 12l-4 40M10 22h44M8 38h44" opacity="0.6" />
        </>
      )}
    </svg>
  )
}
