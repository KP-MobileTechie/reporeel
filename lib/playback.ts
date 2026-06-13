// ---------------------------------------------------------------------------
// playback.ts — pure playback clock.
//
// Models the position of the "playhead" in a repo's history. Time values (t,
// t0, t1) are epoch ms, same unit as Commit.date and Timeline.t0/t1.
//
// At speed 1 the whole history (t0..t1) plays in BASE_DURATION_MS of wall time.
// Higher speeds compress wall time proportionally.
//
// All reducer functions are PURE: they return a NEW state object and never
// mutate the input. This makes them safe to drive React state from.
// ---------------------------------------------------------------------------

/** Wall-clock duration of a full history playthrough at speed 1 (ms). */
export const BASE_DURATION_MS = 90_000;

/** Minimum / maximum playback speed multipliers. */
export const MIN_SPEED = 1;
export const MAX_SPEED = 100;

export interface PlaybackState {
  /** Current playhead time (epoch ms), clamped to [t0, t1]. */
  readonly t: number;
  /** Whether the clock advances on tick(). */
  readonly playing: boolean;
  /** Speed multiplier in [MIN_SPEED, MAX_SPEED]. */
  readonly speed: number;
  /** History start (epoch ms). */
  readonly t0: number;
  /** History end (epoch ms). */
  readonly t1: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Create an initial playback state for the history window [t0, t1].
 * Starts paused at t0, speed 1. Degenerate ranges (t0 === t1, or t1 < t0)
 * collapse to a single instant at t0.
 */
export function createPlayback(t0: number, t1: number): PlaybackState {
  const hi = t1 < t0 ? t0 : t1;
  return { t: t0, playing: false, speed: MIN_SPEED, t0, t1: hi };
}

/** Begin advancing the clock. No-op shape change if already playing. */
export function play(s: PlaybackState): PlaybackState {
  return { ...s, playing: true };
}

/** Halt the clock. */
export function pause(s: PlaybackState): PlaybackState {
  return { ...s, playing: false };
}

/** Set the speed multiplier, clamped to [MIN_SPEED, MAX_SPEED]. */
export function setSpeed(s: PlaybackState, speed: number): PlaybackState {
  return { ...s, speed: clamp(speed, MIN_SPEED, MAX_SPEED) };
}

/** Seek the playhead to `t`, clamped to [t0, t1]. */
export function seek(s: PlaybackState, t: number): PlaybackState {
  return { ...s, t: clamp(t, s.t0, s.t1) };
}

/**
 * Advance the clock by `wallDt` ms of wall-clock time.
 *
 * If not playing, returns the input state unchanged.
 * If playing:
 *   t += wallDt * speed * (t1 - t0) / BASE_DURATION_MS
 * Clamps at t1 AND auto-pauses on reaching it (playing -> false).
 *
 * Degenerate range (t0 === t1): t stays at t0 and the call is a no-op
 * (returns the input state unchanged so React skips re-render).
 */
export function tick(s: PlaybackState, wallDt: number): PlaybackState {
  if (!s.playing) return s;

  const span = s.t1 - s.t0;
  if (span <= 0) return s; // degenerate range: nothing to advance

  const advance = (wallDt * s.speed * span) / BASE_DURATION_MS;
  const next = s.t + advance;

  if (next >= s.t1) {
    return { ...s, t: s.t1, playing: false };
  }
  return { ...s, t: next };
}
