// The stack, read as evidence — not a wall of text.
//
// In-app frames carry their source window (the server resolves it
// from the sourcemap's embedded sourcesContent; no repository
// access anywhere) and open by default: the reader should see the
// failing line without a click. Library frames collapse into a
// single count row — they are context, not suspects.
//
// When the classifier finds NO in-app frame (dev bundles before the
// SDK's Metro symbolication, exotic runtimes), folding would leave
// the reader a single "13 library frames" row and nothing else — so
// in that case every frame is shown flat. An empty-looking stack is
// a UI bug, not a data property.

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
  const anyInApp = shown.some((f) => f.inApp === true);

  // Group runs of library frames so they collapse to one row each —
  // but only when there are in-app frames to anchor the reading.
  const groups: { frames: { f: StackFrame; i: number }[]; inApp: boolean }[] = [];
  shown.forEach((f, i) => {
    const inApp = !anyInApp || f.inApp === true;
    const last = groups.at(-1);
    if (last && last.inApp === inApp) last.frames.push({ f, i });
    else groups.push({ frames: [{ f, i }], inApp });
  });

  return (
    <div className="overflow-hidden">
      {groups.map((g, gi) =>
        g.inApp ? (
          g.frames.map(({ f, i }) => (
            <AppFrame key={i} frame={f} defaultOpen={i < 3} />
          ))
        ) : (
          <LibraryRun key={`lib-${gi}`} frames={g.frames} />
        ),
      )}
      {frames.length > MAX_FRAMES && (
        <div className="border-t border-border px-3.5 py-1.5 font-mono text-xs text-fg-subtle">
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
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        disabled={!hasContext}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasContext ? open : undefined}
        className={`flex w-full items-baseline gap-2 px-3.5 py-2 text-left font-mono text-[13px] ${
          hasContext ? 'cursor-pointer hover:bg-raised' : 'cursor-default'
        }`}
      >
        <span
          className={`inline-block w-3 shrink-0 text-center transition-transform ${
            hasContext ? 'text-fg-subtle' : 'opacity-0'
          } ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="shrink-0 border-l-2 border-kind-error pl-2 font-medium text-fg">
          {frame.function ?? '?'}
        </span>
        <span className="min-w-0 flex-1 truncate text-fg-subtle">
          {frame.file ?? '?'}
          {frame.line !== undefined ? `:${frame.line}` : ''}
          {frame.column !== undefined ? `:${frame.column}` : ''}
        </span>
        {frame.symbolicated !== true && (
          <span className="shrink-0 rounded border border-border-strong px-1 text-[10px] uppercase tracking-wide text-fg-subtle">
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
    <div className="overflow-x-auto border-t border-border bg-bg">
      <table className="w-full border-collapse font-mono text-[13px] leading-6">
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.n}
              style={
                r.hit
                  ? { backgroundColor: 'color-mix(in srgb, var(--s-kind-error) 9%, transparent)' }
                  : undefined
              }
            >
              <td
                className={`w-px select-none border-r py-0 pl-3.5 pr-2 text-right align-top ${
                  r.hit
                    ? 'border-kind-error text-kind-error'
                    : 'border-border text-fg-subtle/70'
                }`}
              >
                {r.n}
              </td>
              <td className="whitespace-pre py-0 pl-3.5 pr-4 text-fg">{r.text || ' '}</td>
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
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 px-3.5 py-1.5 text-left font-mono text-xs text-fg-subtle hover:bg-raised hover:text-fg-muted"
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
          <div
            key={i}
            className="flex items-baseline gap-2 py-0.5 pl-8 pr-3.5 font-mono text-xs text-fg-subtle"
          >
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
