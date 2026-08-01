// The case timeline — the narrative spine of an issue, pinned to
// the bottom of the case file like a video editor's track area.
//
// One horizontal minute, ending on the event: replay frames as
// ticks, user behaviour (nav / tap / http / freeze / trace signals)
// as dots, and the OTHER events this user's app reported in the
// same window — traces walked, probes tripped, asserts failed — as
// flags. That last lane is what turns "a crash happened" into "the
// crash happened right after THIS". Everything is a link: clicking
// any moment (or the bare track) seeks the replay. Hovering reads
// the item out in the strip header.

import { useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import type { IssueSummary } from '../lib/api';
import { kindColor } from './kind';

export type StripSignal = { t: number; kind: string; data?: Record<string, unknown> };
export type StripContextEvent = {
  id: string;
  issueId: string;
  kind: IssueSummary['kind'];
  name: string;
  /** Seconds relative to the event, negative. */
  t: number;
};

const WINDOW_S = 60;

/** Timeline hues borrow the five kind hues so the palette keeps one
 *  concept model: nav reads calm, freeze reads like the error it
 *  usually precedes. */
export function signalColor(kind: string): string {
  switch (kind) {
    case 'nav':
      return 'var(--s-kind-trace)';
    case 'tap':
      return 'var(--s-kind-warn)';
    case 'http':
      return 'var(--s-kind-assert)';
    case 'trace':
      return 'var(--s-kind-probe)';
    case 'freeze':
      return 'var(--s-kind-error)';
    default:
      return 'var(--gds-fg-muted)';
  }
}

export function summarizeSignal(s: StripSignal): string {
  const d = s.data ?? {};
  const parts = Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.join(' ');
}

const pct = (t: number): number =>
  Math.min(100, Math.max(0, ((t + WINDOW_S) / WINDOW_S) * 100));

export function TimelineStrip({
  signals,
  frameTimes,
  context,
  issueKind,
  onSeek,
}: {
  signals: StripSignal[];
  /** Replay frame moments, seconds relative to the event (negative). */
  frameTimes: number[];
  context: StripContextEvent[];
  issueKind: IssueSummary['kind'];
  onSeek?: (t: number) => void;
}) {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState<string | null>(null);

  const inWindow = useMemo(
    () => ({
      signals: signals.filter((s) => s.t >= -WINDOW_S && s.t <= 0),
      frames: frameTimes.filter((f) => f >= -WINDOW_S && f <= 0),
      context: context.filter((c) => c.t >= -WINDOW_S && c.t <= 0),
    }),
    [signals, frameTimes, context],
  );

  const seekFromTrack = (e: React.MouseEvent) => {
    if (!onSeek || !trackRef.current) return;
    const box = trackRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    onSeek(frac * WINDOW_S - WINDOW_S);
  };

  return (
    <section className="flex h-36 shrink-0 flex-col border-t border-border bg-bg">
      <header className="flex h-7 shrink-0 items-center gap-3 border-b border-border px-4">
        <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          {t('issue.timeline')}
        </h3>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-fg-muted">
          {readout ?? ''}
        </span>
      </header>

      <div className="relative min-h-0 flex-1 px-4 py-2">
        {/* lane labels */}
        <div className="pointer-events-none absolute inset-y-2 left-4 z-10 flex w-12 flex-col justify-between py-0.5 font-mono text-[10px] text-fg-subtle">
          <span>{t('strip.frames')}</span>
          <span>{t('strip.signals')}</span>
          <span>{t('strip.events')}</span>
        </div>

        <div
          ref={trackRef}
          role="presentation"
          onClick={seekFromTrack}
          className={`relative ml-14 h-full ${onSeek ? 'cursor-pointer' : ''}`}
        >
          {/* gridlines every 10s + second labels */}
          {Array.from({ length: 7 }, (_, i) => -WINDOW_S + i * 10).map((sec) => (
            <div
              key={sec}
              className="absolute inset-y-0"
              style={{ left: `${pct(sec)}%` }}
            >
              <div
                className={
                  sec === 0
                    ? 'absolute inset-y-0 w-px'
                    : 'absolute inset-y-0 w-px bg-border/60'
                }
                style={sec === 0 ? { backgroundColor: kindColor(issueKind) } : undefined}
              />
              <span
                className={`absolute bottom-0 -translate-x-1/2 font-mono text-[10px] ${
                  sec === 0 ? 'font-semibold' : 'text-fg-subtle'
                }`}
                style={sec === 0 ? { color: kindColor(issueKind) } : undefined}
              >
                {sec === 0 ? t('issue.eventMoment', { kind: issueKind }) : `${sec}s`}
              </span>
            </div>
          ))}

          {/* lane 1 — replay frames as ticks */}
          <div className="absolute inset-x-0 top-[6%] h-[16%]">
            {inWindow.frames.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(f);
                }}
                onMouseEnter={() => setReadout(`${f.toFixed(1)}s`)}
                onMouseLeave={() => setReadout(null)}
                aria-label={`${f.toFixed(1)}s`}
                className="absolute top-0 h-full w-[3px] -translate-x-1/2 rounded-sm bg-border-strong hover:bg-fg-muted"
                style={{ left: `${pct(f)}%` }}
              />
            ))}
          </div>

          {/* lane 2 — behaviour signals as dots */}
          <div className="absolute inset-x-0 top-[38%] h-[16%]">
            {inWindow.signals.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(s.t);
                }}
                onMouseEnter={() =>
                  setReadout(
                    `${s.t.toFixed(1)}s · ${s.kind} ${summarizeSignal(s)}`.trim(),
                  )
                }
                onMouseLeave={() => setReadout(null)}
                aria-label={`${s.t.toFixed(1)}s ${s.kind}`}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg hover:h-3.5 hover:w-3.5"
                style={{ left: `${pct(s.t)}%`, backgroundColor: signalColor(s.kind) }}
              />
            ))}
          </div>

          {/* lane 3 — the other events of the same user's minute */}
          <div className="absolute inset-x-0 top-[68%] h-[16%]">
            {inWindow.context.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(c.t);
                }}
                onMouseEnter={() =>
                  setReadout(`${c.t.toFixed(1)}s · ${c.kind} ${c.name}`)
                }
                onMouseLeave={() => setReadout(null)}
                aria-label={`${c.kind} ${c.name}`}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-bg hover:h-3.5 hover:w-3.5"
                style={{ left: `${pct(c.t)}%`, backgroundColor: kindColor(c.kind) }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
