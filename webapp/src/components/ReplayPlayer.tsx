// The visual replay player — the minute before the event, as the
// user saw it.
//
// The `screens` attachment is NDJSON: one low-bitrate frame per
// line, `t` in seconds relative to the event (negative). Playback
// runs at 4× real time (frames arrive ~2.5s apart on the wire; a
// minute of context should take fifteen seconds to review, not
// sixty). Scrubbing pauses; ←/→ step frames while the player is
// focused.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { api } from '../lib/api';

type ReplayFrame = { t: number; mediaType: string; base64: string };

const PLAYBACK_SPEED = 4;

export function ReplayPlayer({ attachmentRef }: { attachmentRef: string }) {
  const t = useT();
  const [frames, setFrames] = useState<null | ReplayFrame[]>(null);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .fetchAttachmentText(attachmentRef)
      .then((text) => {
        if (!alive) return;
        const parsed = text
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l) as ReplayFrame)
          .filter((f) => typeof f.base64 === 'string');
        setFrames(parsed);
        setIdx(Math.max(0, parsed.length - 1));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attachmentRef]);

  // Advance on a per-frame timer scaled by the real inter-frame gap.
  // The end-of-strip stop happens inside the timer callback (never
  // synchronously in the effect body — react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!playing || !frames || frames.length === 0 || idx >= frames.length - 1) return;
    const gapMs = Math.max(
      100,
      ((frames[idx + 1]!.t - frames[idx]!.t) * 1000) / PLAYBACK_SPEED,
    );
    timerRef.current = setTimeout(() => {
      setIdx((i) => {
        const next = Math.min(i + 1, frames.length - 1);
        if (next >= frames.length - 1) setPlaying(false);
        return next;
      });
    }, gapMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playing, idx, frames]);

  const current = frames?.[idx];
  const src = useMemo(
    () => (current ? `data:${current.mediaType};base64,${current.base64}` : null),
    [current],
  );

  if (failed) {
    return <p className="text-xs opacity-50">{t('replay.loadFailed')}</p>;
  }
  if (!frames) {
    return <p className="text-xs opacity-50">{t('shell.loading')}</p>;
  }
  if (frames.length === 0) {
    return <p className="text-xs opacity-50">{t('replay.empty')}</p>;
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-[var(--gds-border,#2a2a30)] bg-[var(--gds-surface-sunken,#121216)]"
      tabIndex={0}
      role="group"
      aria-label={t('replay.title')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPlaying(false);
          setIdx((i) => Math.min(i + 1, frames.length - 1));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPlaying(false);
          setIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === ' ') {
          e.preventDefault();
          setPlaying((p) => !p);
        }
      }}
    >
      <div className="flex items-center justify-center bg-black/40 p-2">
        {src && (
          <img
            src={src}
            alt={t('replay.frameAlt', { t: current!.t.toFixed(1) })}
            className="max-h-[420px] rounded-sm object-contain"
          />
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--gds-border,#2a2a30)] px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && idx >= frames.length - 1) setIdx(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? t('replay.pause') : t('replay.play')}
          className="w-7 rounded border border-[var(--gds-border,#3a3a42)] py-0.5 text-sm hover:bg-[var(--gds-surface-raised,#1c1c22)]"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={idx}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          aria-label={t('replay.scrubber')}
          className="min-w-0 flex-1 accent-[var(--gds-accent,#4c8dff)]"
        />
        <span className="w-24 shrink-0 text-right font-mono text-[11px] opacity-60">
          {current!.t.toFixed(1)}s · {idx + 1}/{frames.length}
        </span>
      </div>
    </div>
  );
}
