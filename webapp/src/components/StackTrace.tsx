// The stack, read as evidence — not a wall of text.
//
// In-app frames carry their source window (the server resolves it
// from the sourcemap's embedded sourcesContent; no repository
// access anywhere) and open by default: the reader should see the
// failing line without a click. Library frames collapse into a
// single count row — they are context, not suspects. A frame the
// server could not symbolicate says so with a "minified" badge
// instead of pretending its coordinates mean something.

import { useState } from 'react';

import { useT } from '../i18n';

export type StackFrame = {
  file?: string;
  function?: string;
  line?: number;
  column?: number;
  inApp?: boolean;
  symbolicated?: boolean;
  preContext?: string[];
  contextLine?: string;
  postContext?: string[];
};

const MAX_FRAMES = 40;

export function StackTrace({ frames }: { frames: StackFrame[] }) {
  const t = useT();
  const shown = frames.slice(0, MAX_FRAMES);

  // Group runs of library frames so they collapse to one row each.
  const groups: { frames: { f: StackFrame; i: number }[]; inApp: boolean }[] = [];
  shown.forEach((f, i) => {
    const inApp = f.inApp === true;
    const last = groups.at(-1);
    if (last && last.inApp === inApp) last.frames.push({ f, i });
    else groups.push({ frames: [{ f, i }], inApp });
  });

  return (
    <div className="overflow-hidden rounded-md border border-[var(--gds-border,#2a2a30)] bg-[var(--gds-surface-sunken,#121216)]">
      {groups.map((g, gi) =>
        g.inApp ? (
          g.frames.map(({ f, i }) => <AppFrame key={i} frame={f} defaultOpen />)
        ) : (
          <LibraryRun key={`lib-${gi}`} frames={g.frames} />
        ),
      )}
      {frames.length > MAX_FRAMES && (
        <div className="border-t border-[var(--gds-border,#2a2a30)] px-3 py-1.5 font-mono text-[11px] opacity-40">
          {t('stack.truncated', { n: String(frames.length - MAX_FRAMES) })}
        </div>
      )}
    </div>
  );
}

/** One in-app frame: header row + (when the server resolved it) the
 *  source window. */
function AppFrame({ frame, defaultOpen }: { frame: StackFrame; defaultOpen: boolean }) {
  const t = useT();
  const hasContext = typeof frame.contextLine === 'string';
  const [open, setOpen] = useState(defaultOpen && hasContext);

  return (
    <div className="border-b border-[var(--gds-border,#2a2a30)] last:border-b-0">
      <button
        type="button"
        disabled={!hasContext}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasContext ? open : undefined}
        className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-mono text-xs ${
          hasContext ? 'cursor-pointer hover:bg-[var(--gds-surface-raised,#1c1c22)]' : 'cursor-default'
        }`}
      >
        <span
          className={`inline-block w-3 shrink-0 text-center transition-transform ${
            hasContext ? 'opacity-50' : 'opacity-0'
          } ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="border-l-2 border-[#ff5d5d] pl-2 font-medium text-[var(--gds-text,#e5e5ea)]">
          {frame.function ?? '?'}
        </span>
        <span className="min-w-0 flex-1 truncate opacity-50">
          {frame.file ?? '?'}
          {frame.line !== undefined ? `:${frame.line}` : ''}
          {frame.column !== undefined ? `:${frame.column}` : ''}
        </span>
        {frame.symbolicated !== true && (
          <span className="shrink-0 rounded border border-[var(--gds-border,#3a3a42)] px-1 text-[10px] uppercase tracking-wide opacity-50">
            {t('stack.minified')}
          </span>
        )}
      </button>
      {open && hasContext && <SourceWindow frame={frame} />}
    </div>
  );
}

/** The reading window around the failing line, numbered from the
 *  resolved position. The hit line carries the tint + red gutter. */
function SourceWindow({ frame }: { frame: StackFrame }) {
  const pre = frame.preContext ?? [];
  const post = frame.postContext ?? [];
  const hitLine = frame.line ?? 0;
  const start = hitLine - pre.length;
  const rows: { n: number; text: string; hit: boolean }[] = [
    ...pre.map((text, i) => ({ n: start + i, text, hit: false })),
    { n: hitLine, text: frame.contextLine ?? '', hit: true },
    ...post.map((text, i) => ({ n: hitLine + 1 + i, text, hit: false })),
  ];

  return (
    <div className="overflow-x-auto border-t border-[var(--gds-border,#2a2a30)] bg-[var(--gds-bg,#0d0d10)]">
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className={r.hit ? 'bg-[rgba(255,93,93,0.09)]' : ''}>
              <td
                className={`w-px select-none border-r py-0 pl-3 pr-2 text-right align-top ${
                  r.hit
                    ? 'border-[#ff5d5d] text-[#ff5d5d]'
                    : 'border-[var(--gds-border,#2a2a30)] opacity-35'
                }`}
              >
                {r.n}
              </td>
              <td className="whitespace-pre py-0 pl-3 pr-4">{r.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A run of consecutive library frames, folded to one row. */
function LibraryRun({ frames }: { frames: { f: StackFrame; i: number }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[var(--gds-border,#2a2a30)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-mono text-[11px] opacity-45 hover:bg-[var(--gds-surface-raised,#1c1c22)] hover:opacity-70"
      >
        <span
          className={`inline-block w-3 shrink-0 text-center transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        {open
          ? t('stack.libraryFramesOpen')
          : t('stack.libraryFrames', { n: String(frames.length) })}
      </button>
      {open &&
        frames.map(({ f, i }) => (
          <div key={i} className="flex items-baseline gap-2 py-0.5 pl-8 pr-3 font-mono text-[11px] opacity-40">
            <span>{f.function ?? '?'}</span>
            <span className="min-w-0 flex-1 truncate">
              {f.file ?? '?'}
              {f.line !== undefined ? `:${f.line}` : ''}
            </span>
          </div>
        ))}
    </div>
  );
}
