"use client";

import { useMemo } from "react";

const SPEEDS = [1, 5, 25, 100];

function formatMonth(t: number): string {
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Build a 100-bucket density sparkline path from commit times in [t0,t1]. */
function buildSparkline(times: number[], t0: number, t1: number): string {
  const BUCKETS = 100;
  const counts = new Array(BUCKETS).fill(0);
  const span = t1 - t0;
  if (span > 0) {
    for (const t of times) {
      let b = Math.floor(((t - t0) / span) * BUCKETS);
      if (b < 0) b = 0;
      if (b >= BUCKETS) b = BUCKETS - 1;
      counts[b]++;
    }
  }
  const max = Math.max(1, ...counts);
  // Map to a 0..100 x by 0..24 y SVG path (y inverted).
  const pts = counts.map((c, i) => {
    const x = (i / (BUCKETS - 1)) * 100;
    const y = 24 - (c / max) * 22;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `M0,24 L${pts.join(" L")} L100,24 Z`;
}

export function TimelineBar({
  t0,
  t1,
  t,
  playing,
  speed,
  commitTimes,
  disabled,
  onPlayPause,
  onSpeed,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  t0: number;
  t1: number;
  t: number;
  playing: boolean;
  speed: number;
  commitTimes: number[];
  disabled: boolean;
  onPlayPause: () => void;
  onSpeed: (s: number) => void;
  onSeek: (t: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const sparkPath = useMemo(
    () => buildSparkline(commitTimes, t0, t1),
    [commitTimes, t0, t1],
  );

  return (
    <div className="rounded-xl bg-black/50 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={disabled}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="3.5" height="12" rx="1" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 1.5v11l10-5.5z" />
            </svg>
          )}
        </button>

        {/* Scrubber + sparkline */}
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={sparkPath} className="fill-accent/20" />
          </svg>
          <label className="sr-only" htmlFor="scrubber">
            Timeline position
          </label>
          <input
            id="scrubber"
            type="range"
            min={t0}
            max={t1 <= t0 ? t0 + 1 : t1}
            value={t}
            step="any"
            disabled={disabled}
            onPointerDown={onScrubStart}
            onPointerUp={onScrubEnd}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="reporeel-scrubber relative z-10 w-full"
          />
        </div>

        <div className="w-24 shrink-0 text-right text-sm tabular-nums text-fg">
          {formatMonth(t)}
        </div>

        <label className="sr-only" htmlFor="speed">
          Playback speed
        </label>
        <select
          id="speed"
          value={speed}
          disabled={disabled}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg disabled:opacity-40"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 text-center text-[11px] tracking-wide text-fg-dim">
        space · ← → · + −
      </div>
    </div>
  );
}
