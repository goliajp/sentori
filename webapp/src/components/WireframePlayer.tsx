// The wireframe replay — the minute before the event, redrawn.
//
// What the SDK captures here is not video: per tick, the rectangles
// that made up the screen, with text and fill where the native
// layer could read them. It costs a fraction of a screen recording
// and cannot leak a password field the way a bitmap can — which is
// why it is always on, while pixel capture (`replayScreens`) is
// opt-in. This player renders it when an event carries no pixels.
//
// On the wire it is NDJSON: a keyframe listing every node, then
// deltas listing only what changed. Reconstruction walks from the
// last keyframe and applies deltas forward — the same shape a video
// codec uses, for the same reason. The viewport is square, like the
// visual player's: portrait and landscape recordings both letterbox
// inside the canvas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import { api } from '../lib/api';

type Node = {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: string;
  text?: string;
  color?: string;
};

type Frame =
  | { ts: number; kind: 'key'; width: number; height: number; nodes: Node[] }
  | {
      ts: number;
      kind: 'delta';
      added: Node[];
      changed: Node[];
      removed: Pick<Node, 'x' | 'y' | 'w' | 'h'>[];
    };

/** NDJSON to frames. One malformed line must not cost the whole
 *  recording: the format is append-only, so a truncated tail is the
 *  expected failure rather than a corrupt file. */
function decodeFrames(text: string): Frame[] {
  const out: Frame[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Frame);
    } catch {
      /* a partial last line is normal */
    }
  }
  return out;
}

const fp = (n: Pick<Node, 'x' | 'y' | 'w' | 'h'>) =>
  `${n.x | 0},${n.y | 0},${n.w | 0},${n.h | 0}`;

const CANVAS_PX = 640;

export function WireframePlayer({ attachmentRef }: { attachmentRef: string }) {
  const t = useT();
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .fetchAttachmentText(attachmentRef)
      .then((text) => {
        if (!alive) return;
        const decoded = decodeFrames(text);
        setFrames(decoded);
        setIndex(Math.max(0, decoded.length - 1));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [attachmentRef]);

  /** Screen size comes from the most recent keyframe at or before the
   *  playhead — a rotation mid-recording changes it. */
  const { nodes, width, height } = useMemo(() => {
    if (!frames?.length) return { nodes: [], width: 0, height: 0 };
    const state = new Map<string, Node>();
    let w = 0;
    let h = 0;
    for (let i = 0; i <= Math.min(index, frames.length - 1); i++) {
      const f = frames[i]!;
      if (f.kind === 'key') {
        state.clear();
        for (const n of f.nodes) state.set(fp(n), n);
        w = f.width;
        h = f.height;
      } else {
        for (const n of f.removed) state.delete(fp(n));
        for (const n of f.added) state.set(fp(n), n);
        for (const n of f.changed) state.set(fp(n), n);
      }
    }
    return { nodes: [...state.values()], width: w, height: h };
  }, [frames, index]);

  // Playback steps frame-to-frame at the recording's own pacing,
  // clamped so a long idle gap doesn't stall the playhead.
  useEffect(() => {
    if (!playing || !frames?.length) return;
    const last = frames.length - 1;
    if (index >= last) return;
    const gap = Math.min(2000, Math.max(60, frames[index + 1]!.ts - frames[index]!.ts));
    const id = setTimeout(() => {
      const next = index + 1;
      setIndex(next);
      if (next >= last) setPlaying(false);
    }, gap);
    return () => clearTimeout(id);
  }, [playing, frames, index]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = Math.min(canvas.width / width, canvas.height / height);
    const ox = (canvas.width - width * scale) / 2;
    const oy = (canvas.height - height * scale) / 2;

    const css = getComputedStyle(document.documentElement);
    const surface = css.getPropertyValue('--s-surface').trim() || '#18181b';
    const outline = css.getPropertyValue('--s-border-strong').trim() || '#3f3f46';
    const ink = css.getPropertyValue('--s-fg-muted').trim() || '#a1a1aa';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = surface;
    ctx.fillRect(ox, oy, width * scale, height * scale);

    // Everything draws inside the device rectangle. SDKs before
    // 5.1.3 report scroll content at its full unclipped size (a
    // 2000pt ruler arrives as 2000pt), so the clip is what keeps
    // historical recordings inside the phone.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, width * scale, height * scale);
    ctx.clip();

    // Solid fills only — per-node strokes turned a busy screen into
    // a grid of borders. Layers separate by luminance, the way a
    // squinted-at screenshot would; an image is a flat neutral
    // block, not a hollow frame.
    for (const n of nodes) {
      const x = ox + n.x * scale;
      const y = oy + n.y * scale;
      const w = n.w * scale;
      const h = n.h * scale;
      if (n.color) {
        ctx.fillStyle = n.color;
        ctx.fillRect(x, y, w, h);
      } else if (n.kind === 'image') {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.45)';
        ctx.fillRect(x, y, w, h);
      }
      if (n.text && h > 10) {
        ctx.fillStyle = ink;
        ctx.font = `${Math.max(9, Math.min(13, h * scale * 0.5))}px ui-monospace, monospace`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillText(n.text, x + 4, y + Math.min(h - 4, 13));
        ctx.restore();
      }
    }
    ctx.restore();

    // One outline for the device itself, so the phone still reads as
    // an object against the canvas.
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, width * scale - 1, height * scale - 1);
  }, [nodes, width, height]);

  useEffect(draw, [draw]);

  if (failed) {
    return <p className="text-sm text-fg-subtle">{t('replay.loadFailed')}</p>;
  }
  if (!frames) {
    return <p className="text-sm text-fg-subtle">{t('shell.loading')}</p>;
  }
  if (frames.length === 0) {
    return <p className="text-sm text-fg-subtle">{t('replay.empty')}</p>;
  }

  const last = frames.length - 1;
  const elapsed = ((frames[index]!.ts - frames[0]!.ts) / 1000).toFixed(1);
  const total = ((frames[last]!.ts - frames[0]!.ts) / 1000).toFixed(1);

  return (
    <div
      className="overflow-hidden"
      tabIndex={0}
      role="group"
      aria-label={t('replay.title')}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPlaying(false);
          setIndex((i) => Math.min(i + 1, last));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPlaying(false);
          setIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === ' ') {
          e.preventDefault();
          setPlaying((p) => !p);
        }
      }}
    >
      <div className="flex aspect-square w-full items-center justify-center bg-bg p-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_PX}
          height={CANVAS_PX}
          className="h-full w-full"
        />
      </div>
      <div className="flex items-center gap-2.5 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (!playing && index >= last) setIndex(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? t('replay.pause') : t('replay.play')}
          className="h-7 w-7 shrink-0 rounded border border-border-strong text-sm text-fg hover:bg-raised"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          aria-label={t('replay.scrubber')}
          className="min-w-0 flex-1 accent-accent"
        />
        <span className="shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
          {elapsed}s / {total}s · {index + 1}/{frames.length}
        </span>
      </div>
    </div>
  );
}
