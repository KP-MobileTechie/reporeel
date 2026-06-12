/**
 * sim.ts — pure, deterministic force layout for the RepoReel galaxy.
 *
 * Design notes:
 * - ALL functions are pure (no global side-effects on positions/velocities from outside step()).
 * - step() is allocation-free per-pair: a module-scope scratch Map and per-bucket arrays
 *   are cleared and reused each call. No new Map / new Array() inside the hot loop.
 *   Workers are single-threaded, so module-scope scratch is safe. step() is NOT re-entrant;
 *   there must be at most one sim instance per module instance.
 * - dt is used directly as the force/velocity multiplier (not converted to seconds).
 *   This keeps the simulation deterministic as long as callers pass consistent dt values.
 * - dtClamped = Math.min(dt, MAX_DT) prevents blow-up on tab-hidden bursts.
 * - Velocity magnitude (after dt-scaling) is clamped to MAX_SPEED each step to prevent
 *   divergence when many stars start coincident (dir 0 anchor sits at the origin).
 *
 * Cross-engine determinism guarantee:
 *   computeAnchors and initPositions use detSin/detCos instead of Math.sin/Math.cos.
 *   Math.sqrt, Math.floor, Math.min, Math.max are IEEE-exact. No transcendentals remain
 *   in the layout path, so the same repo produces the same galaxy on any JS engine.
 */

import { mulberry32 } from "./prng";

// ── Exported constants ────────────────────────────────────────────────────────
export const CLUSTER_RADIUS = 60;
export const CELL_SIZE = 24;
export const REPEL_RADIUS = 16;
export const REPEL_FORCE = 1;
export const SPRING_K = 0.02;
export const DAMPING = 0.9;
export const MAX_DT = 32;
/** Maximum speed (units/ms) — the velocity magnitude (after dt-scaling) is clamped
 *  to this value each step to prevent blow-up when many stars start coincident
 *  at the origin (dir 0 anchor). */
export const MAX_SPEED = 200;
export const SPIRAL_STEP = 140;
export const GOLDEN_ANGLE = 2.399963229728653;

// ── Cross-engine deterministic trig ──────────────────────────────────────────
// Bit-identical across engines: only +,-,*,/ and Math.floor (IEEE-exact).
// 7th-order odd polynomial after range reduction; ~1e-5 accuracy is plenty for layout jitter.
const TWO_PI = 6.283185307179586;
function detSin(x: number): number {
  x = x - TWO_PI * Math.floor(x / TWO_PI + 0.5); // reduce to [-PI, PI]
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42)));
}
function detCos(x: number): number { return detSin(x + 1.5707963267948966); }

// ── Spatial-hash scratch (module-scope, reused each step) ─────────────────────
// We preallocate a Map<cellKey, number[]> and reuse it each step call.
// Arrays inside the map are reset by setting their .length = 0, avoiding new[].
// This satisfies the "no per-pair allocation" contract; per-cell arrays grow once
// and stay alive for the lifetime of the worker.
//
// _fx / _fy are force-accumulation scratch arrays, hoisted here to avoid allocating
// two Float64Array(n) on every step() call (which generates ~14 MB/s of GC pressure
// at 15 k stars / 60 Hz). They grow on demand (reallocated only when n exceeds
// capacity) and are zero-filled with .fill(0, 0, n) before each use.
const _grid = new Map<number, number[]>();
let _fx = new Float64Array(0);
let _fy = new Float64Array(0);

/** Encode a (cx, cy) cell coordinate into a single integer key. */
function cellKey(cx: number, cy: number): number {
  // Cantor-style packing with signed coordinate support via bias.
  // Range: cx/cy in [-16384, 16384] → fits in 32-bit range.
  const bx = cx + 16384;
  const by = cy + 16384;
  return (bx * 32769 + by) | 0;
}

// ── Anchor computation ────────────────────────────────────────────────────────

/**
 * Compute 2*dirCount Float32Array of anchor positions (x0,y1, x1,y1, …).
 * Anchors are on a seeded golden-angle spiral so they spread directories evenly.
 * A small jitter from mulberry32(seed) is applied to each anchor to break symmetry.
 */
export function computeAnchors(dirCount: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(2 * dirCount);
  for (let k = 0; k < dirCount; k++) {
    const r = SPIRAL_STEP * Math.sqrt(k);
    const angle = k * GOLDEN_ANGLE + (rand() - 0.5) * 0.3;
    out[2 * k] = r * detCos(angle);
    out[2 * k + 1] = r * detSin(angle);
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * initPositions — create initial star positions deterministically.
 *
 * Each star is placed within CLUSTER_RADIUS of its directory anchor.
 * A single PRNG stream (seeded with `seed`) is consumed in star-index order
 * so the result is fully reproducible on any JS engine.
 *
 * Returns a Float32Array of length 2*N with (x,y) interleaved.
 */
export function initPositions(
  starDirs: number[],
  dirCount: number,
  seed: number
): Float32Array {
  // Anchors consume the first part of the PRNG stream via a separate seeded rand.
  // We use seed+1 for stars so anchor jitter and star scatter don't share state.
  const anchors = computeAnchors(dirCount, seed);
  const rand = mulberry32(seed + 1);

  const n = starDirs.length;
  const positions = new Float32Array(2 * n);

  for (let i = 0; i < n; i++) {
    const dir = starDirs[i];
    const ax = anchors[2 * dir];
    const ay = anchors[2 * dir + 1];
    // Random polar offset within CLUSTER_RADIUS (factor 0.999 keeps boundary away
    // from the Float32 rounding edge that could otherwise exceed CLUSTER_RADIUS).
    const angle = rand() * TWO_PI;
    const radius = rand() * CLUSTER_RADIUS * 0.999;
    positions[2 * i] = ax + radius * detCos(angle);
    positions[2 * i + 1] = ay + radius * detSin(angle);
  }

  return positions;
}

/**
 * step — in-place force integration for one time step.
 *
 * NOT re-entrant: uses module-scope scratch arrays (_grid, _fx, _fy).
 * Only one sim per module instance is supported.
 *
 * Forces applied per star:
 *   1. Spring toward own directory anchor: f = (anchor - pos) * SPRING_K
 *   2. Pairwise repulsion with nearby stars (within REPEL_RADIUS) via spatial hash.
 *      Force magnitude: REPEL_FORCE / max(d, 0.5), along the separation vector.
 *      Applied symmetrically to both stars in a pair.
 *
 * Integration (semi-implicit Euler):
 *   v = (v + f * dtClamped) * DAMPING
 *   pos += v * dtClamped
 *
 * No allocation inside per pair — the module-scope _grid Map and its bucket arrays
 * are cleared (length = 0) and reused. _fx/_fy are grown on demand and zero-filled.
 * This is safe because the worker is single-threaded.
 */
export function step(
  positions: Float32Array,
  velocities: Float32Array,
  starDirs: number[],
  anchors: Float32Array,
  dt: number
): void {
  const n = starDirs.length;
  if (n === 0) return;

  const dtClamped = Math.min(dt, MAX_DT);

  // ── 1. Accumulate forces ──────────────────────────────────────────────────
  // Grow module-scope scratch arrays on demand; zero-fill the used portion.
  if (_fx.length < n) {
    _fx = new Float64Array(n);
    _fy = new Float64Array(n);
  } else {
    _fx.fill(0, 0, n);
    _fy.fill(0, 0, n);
  }

  // Spring force toward anchor
  for (let i = 0; i < n; i++) {
    const dir = starDirs[i];
    const ax = anchors[2 * dir];
    const ay = anchors[2 * dir + 1];
    _fx[i] += (ax - positions[2 * i]) * SPRING_K;
    _fy[i] += (ay - positions[2 * i + 1]) * SPRING_K;
  }

  // ── 2. Spatial hash: bucket stars by cell ─────────────────────────────────
  // Clear existing buckets (reuse arrays, avoid allocation)
  for (const bucket of _grid.values()) {
    bucket.length = 0;
  }

  for (let i = 0; i < n; i++) {
    const cx = Math.floor(positions[2 * i] / CELL_SIZE);
    const cy = Math.floor(positions[2 * i + 1] / CELL_SIZE);
    const key = cellKey(cx, cy);
    let bucket = _grid.get(key);
    if (bucket === undefined) {
      bucket = [];
      _grid.set(key, bucket);
    }
    bucket.push(i);
  }

  // ── 3. Pairwise repulsion (only within REPEL_RADIUS) ─────────────────────
  // For each star, check its cell and 8 neighbours.
  for (let i = 0; i < n; i++) {
    const px = positions[2 * i];
    const py = positions[2 * i + 1];
    const cx = Math.floor(px / CELL_SIZE);
    const cy = Math.floor(py / CELL_SIZE);

    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcy = -1; dcy <= 1; dcy++) {
        const key = cellKey(cx + dcx, cy + dcy);
        const bucket = _grid.get(key);
        if (bucket === undefined) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi];
          if (j <= i) continue; // process each pair once
          const dx = px - positions[2 * j];
          const dy = py - positions[2 * j + 1];
          const d2 = dx * dx + dy * dy;
          if (d2 > REPEL_RADIUS * REPEL_RADIUS) continue;
          const d = Math.sqrt(d2);
          const dSafe = Math.max(d, 0.5);
          const mag = REPEL_FORCE / dSafe;
          const ux = dx / dSafe;
          const uy = dy / dSafe;
          _fx[i] += ux * mag;
          _fy[i] += uy * mag;
          _fx[j] -= ux * mag;
          _fy[j] -= uy * mag;
        }
      }
    }
  }

  // ── 4. Integrate ──────────────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    let vx = (velocities[2 * i] + _fx[i] * dtClamped) * DAMPING;
    let vy = (velocities[2 * i + 1] + _fy[i] * dtClamped) * DAMPING;
    // Clamp velocity magnitude to MAX_SPEED to prevent blow-up when
    // many stars start coincident at the origin (dir 0 anchor).
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > MAX_SPEED) {
      const inv = MAX_SPEED / speed;
      vx *= inv;
      vy *= inv;
    }
    velocities[2 * i] = vx;
    velocities[2 * i + 1] = vy;
    positions[2 * i] += vx * dtClamped;
    positions[2 * i + 1] += vy * dtClamped;
  }
}
